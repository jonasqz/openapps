/**
 * `describeActor` gegen echtes Postgres: Die Abfrage ueber mehrere Subjekte
 * (`listForSubjects` mit `unnest`) ist nur dort wirklich geprueft, und der
 * Audit-Eintrag `whoami` muss in `audit_log` landen, ohne dass eine Migration
 * die Aktion kennt (Migration 0004: `action` ist freier Text).
 *
 * Laeuft gegen die Instanz aus `docker-compose.yml`; ist sie nicht
 * erreichbar, ueberspringt sich die Datei (wie `grants-postgres.spec.ts`).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createApp,
  describeActor,
  grant,
  revoke,
  systemClock,
  uuidIds,
  type Actor,
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
  createGrantRepository,
  createGroupRepository,
} from '../src/infra/pg';
import { freshDatabase, postgresReachable, type PgFixture } from './pg-helpers';
import { admin, manifest, testGatewaySettings, TEST_MASTER_SECRET } from './helpers';

const reachable = await postgresReachable();

const lena: Actor = { kind: 'user', id: 'u-lena', groups: ['team'] };

describe.skipIf(!reachable)('describeActor gegen Postgres', () => {
  let db: PgFixture;
  let ctx: DomainContext;

  beforeEach(async () => {
    db = await freshDatabase();
    ctx = {
      apps: createAppRepository(db.pool),
      deployments: createDeploymentRepository(db.pool),
      grants: createGrantRepository(db.pool),
      groups: createGroupRepository(db.pool),
      audit: createAuditRepository(db.pool),
      agents: createAgentIdentityRepository(db.pool),
      clock: systemClock,
      ids: uuidIds,
      appsDomain: 'apps.example.com',
      backend: createRecordingBackend(),
      gatewayConfig: createRecordingGatewayConfigStore(),
      gatewaySettings: testGatewaySettings(),
      repositories: createRecordingRepositoryBackend(),
      reviewGate: createPipeline([]),
      // Schema und Rolle sind hier nicht der Gegenstand, nur die Freigaben.
      provisioner: createRecordingProvisioner(),
      authMasterSecret: TEST_MASTER_SECRET,
    };
    await createApp(ctx, { actor: admin, name: 'crm', manifest: manifest('crm') });
    await createApp(ctx, { actor: admin, name: 'wiki', manifest: manifest('wiki') });
  });

  afterEach(async () => {
    await db.close();
  });

  it('liefert eigene und Gruppen-Freigaben mit Herkunft, keine fremden, keine widerrufenen', async () => {
    const direct = await grant(ctx, {
      actor: admin,
      subject: { kind: 'user', id: 'u-lena' },
      verb: 'read',
      resource: { kind: 'app', id: 'crm' },
    });
    await grant(ctx, {
      actor: admin,
      subject: { kind: 'group', id: 'team' },
      verb: 'read',
      resource: { kind: 'app', id: 'crm' },
    });
    // Fremd: eine andere Gruppe, eine andere Person, ein Agent mit gleicher Id.
    await grant(ctx, {
      actor: admin,
      subject: { kind: 'group', id: 'sales' },
      verb: 'read',
      resource: { kind: 'app', id: 'wiki' },
    });
    await grant(ctx, {
      actor: admin,
      subject: { kind: 'user', id: 'u-tom' },
      verb: 'read',
      resource: { kind: 'app', id: 'wiki' },
    });
    await grant(ctx, {
      actor: admin,
      subject: { kind: 'agent', id: 'u-lena' },
      verb: 'read',
      resource: { kind: 'app', id: 'wiki' },
    });
    const revoked = await grant(ctx, {
      actor: admin,
      subject: { kind: 'group', id: 'team' },
      verb: 'write',
      resource: { kind: 'app', id: 'crm' },
    });
    await revoke(ctx, { actor: admin, grantId: revoked.id });

    const me = await describeActor(ctx, lena);
    expect(me.grants.map((g) => ({ id: g.id, verb: g.verb, via: g.via }))).toEqual([
      { id: direct.id, verb: 'read', via: { kind: 'direct' } },
      { id: expect.any(String), verb: 'read', via: { kind: 'group', group: 'team' } },
    ]);
    expect(me.apps.map((a) => a.name)).toEqual(['crm']);
  });

  it('schreibt genau eine Zeile whoami in audit_log', async () => {
    await describeActor(ctx, lena, { correlationId: 'req-pg-1' });
    const { rows } = await db.pool.query<{
      action: string;
      outcome: string;
      resource_kind: string | null;
    }>(
      `SELECT action, outcome::text AS outcome, resource_kind::text AS resource_kind
         FROM audit_log WHERE actor_id = 'u-lena' ORDER BY id`,
    );
    expect(rows).toEqual([{ action: 'whoami', outcome: 'allowed', resource_kind: null }]);
  });
});
