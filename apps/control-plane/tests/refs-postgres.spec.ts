/**
 * ADR 0023, Schritte 3 und 4 gegen Postgres (Migration 0020). Dieselbe Folge
 * wie in `refs.spec.ts`, aber mit den echten Repositories: Stand je Quelle
 * unter Sperre, leere Menge behaelt den Stand, Rueckverweise ueber den Index,
 * Erwaehnungen in den Eingang.
 *
 * Laeuft gegen die Instanz aus `docker-compose.yml`; ist sie nicht
 * erreichbar, ueberspringt sie sich.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createApp,
  grant,
  listBacklinks,
  listInbox,
  PermissionDeniedError,
  setRefs,
  uuidIds,
  type Actor,
  type AppManifest,
  type DomainContext,
} from '../src/domain';
import { createPipeline } from '../src/domain/review-gate';
import {
  createRecordingBackend,
  createRecordingGatewayConfigStore,
  createRecordingProvisioner,
  createRecordingRepositoryBackend,
} from '../src/infra/memory/doubles';
import {
  createAgentIdentityRepository,
  createAppRepository,
  createAuditRepository,
  createDeploymentRepository,
  createEventRepository,
  createGrantRepository,
  createGroupRepository,
  createRefRepository,
  createUserDirectory,
} from '../src/infra/pg';
import { freshDatabase, postgresReachable, type PgFixture } from './pg-helpers';
import { admin, manifest, testGatewaySettings, TEST_MASTER_SECRET } from './helpers';

const reachable = await postgresReachable();

const WIKI: Actor = { kind: 'app', id: 'wiki' };
const ben: Actor = { kind: 'user', id: 'u-ben', groups: [] };

function withObjects(name: string, type: string): AppManifest {
  const base = manifest(name);
  return {
    ...base,
    offeredTools: [
      ...base.offeredTools,
      { name: 'resolve', description: 'Resolve.', verb: 'read', operationId: 'resolve' },
    ],
    objects: [{ type, description: `A ${type}.`, resolver: 'resolve' }],
  };
}

describe.skipIf(!reachable)('Verweise gegen Postgres', () => {
  let db: PgFixture;
  let ctx: DomainContext;
  const now = new Date();

  beforeEach(async () => {
    db = await freshDatabase();
    ctx = {
      apps: createAppRepository(db.pool),
      deployments: createDeploymentRepository(db.pool),
      grants: createGrantRepository(db.pool),
      groups: createGroupRepository(db.pool),
      audit: createAuditRepository(db.pool),
      agents: createAgentIdentityRepository(db.pool),
      events: createEventRepository(db.pool),
      users: createUserDirectory(db.pool),
      refs: createRefRepository(db.pool),
      clock: { now: () => now },
      ids: uuidIds,
      appsDomain: 'apps.example.com',
      backend: createRecordingBackend(),
      gatewayConfig: createRecordingGatewayConfigStore(),
      gatewaySettings: testGatewaySettings(),
      repositories: createRecordingRepositoryBackend(),
      reviewGate: createPipeline([]),
      provisioner: createRecordingProvisioner(),
      authMasterSecret: TEST_MASTER_SECRET,
    };
    await createApp(ctx, { actor: admin, name: 'tasks', manifest: withObjects('tasks', 'task') });
    await createApp(ctx, { actor: admin, name: 'wiki', manifest: withObjects('wiki', 'page') });
    await db.pool.query(
      `INSERT INTO control_plane."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ('u-ben', 'Ben', 'ben@example.com', true, now(), now())`,
    );
  });

  afterEach(async () => {
    await db.close();
  });

  const read = (subject: { kind: Actor['kind']; id: string }, app: string) =>
    grant(ctx, { actor: admin, subject, verb: 'read', resource: { kind: 'app', id: app } });
  const at = (offsetMs: number) => new Date(now.getTime() - offsetMs).toISOString();
  const report = (targets: string[], updatedAt: string) =>
    setRefs(ctx, {
      actor: WIKI,
      args: { source: 'wiki:page:p1', targets, updatedAt, title: 'Notes', path: '/pages/p1' },
    });

  it('ohne Freigabe nichts, mit Freigabe Rueckverweis nur fuer Leser beider Apps', async () => {
    await expect(report(['tasks:task:42'], at(1000))).rejects.toThrow(PermissionDeniedError);
    await grant(ctx, {
      actor: admin,
      subject: WIKI,
      verb: 'execute',
      resource: { kind: 'tool', id: 'platform.set_refs' },
    });
    expect(await report(['tasks:task:42'], at(1000))).toMatchObject({ status: 'applied' });

    await read(ben, 'tasks');
    expect((await listBacklinks(ctx, { actor: ben, ref: 'tasks:task:42' })).backlinks).toEqual([]);
    await read(ben, 'wiki');
    expect(
      (await listBacklinks(ctx, { actor: ben, ref: 'tasks:task:42' })).backlinks.map(
        (b) => b.source,
      ),
    ).toEqual(['wiki:page:p1']);
  });

  it('aelterer Stand aendert nichts, leere Menge loescht, Erwaehnung nur einmal', async () => {
    await grant(ctx, {
      actor: admin,
      subject: WIKI,
      verb: 'execute',
      resource: { kind: 'tool', id: 'platform.set_refs' },
    });
    await read(ben, 'wiki');
    expect(await report(['tasks:task:42', 'human:ben@example.com'], at(2000))).toMatchObject({
      status: 'applied',
      mentioned: 1,
    });
    expect(await report(['tasks:task:1'], at(3000))).toMatchObject({ status: 'stale' });
    expect(await report(['tasks:task:42', 'human:ben@example.com'], at(1500))).toMatchObject({
      mentioned: 0,
    });
    const inbox = await listInbox(ctx, { actor: ben, email: 'ben@example.com' });
    expect(inbox.items.map((item) => item.type)).toEqual(['platform.mentioned']);

    expect(await report([], at(1000))).toMatchObject({ status: 'applied', targets: 0 });
    expect(await ctx.refs?.listOutgoing('wiki:page:p1')).toEqual([]);
    expect(await report(['tasks:task:42'], at(1200))).toMatchObject({ status: 'stale' });
  });
});
