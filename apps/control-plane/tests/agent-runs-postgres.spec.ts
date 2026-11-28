/**
 * ADR 0024 gegen Postgres (Migrationen 0021 bis 0024): Nutzung je Tag,
 * Profile, Warteschlange mit `FOR UPDATE SKIP LOCKED`, eine Erwaehnung genau
 * ein Lauf (`dedupe_key`), unterbrochene Laeufe, Gedaechtnis mit Herkunft als
 * Teilmenge (`apps <@ lesbar`) und hartes Loeschen.
 *
 * Laeuft gegen die Instanz aus `docker-compose.yml`; ist sie nicht
 * erreichbar, ueberspringt sie sich.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  claimAgentRun,
  configureAgent,
  createAgentIdentity,
  createApp,
  executeAgentRun,
  failInterruptedRuns,
  grant,
  recall,
  remember,
  startAgentRun,
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
  createScriptedModelProvider,
  scriptedModelSetup,
} from '../src/infra/memory/doubles';
import {
  createAgentIdentityRepository,
  createAgentProfileRepository,
  createAgentRunRepository,
  createAppRepository,
  createAuditRepository,
  createDeploymentRepository,
  createEventRepository,
  createGrantRepository,
  createGroupRepository,
  createModelUsageRepository,
  createRefRepository,
  createTeamMemoryStore,
  createUserDirectory,
} from '../src/infra/pg';
import { freshDatabase, postgresReachable, type PgFixture } from './pg-helpers';
import { admin, manifest, testGatewaySettings, TEST_MASTER_SECRET } from './helpers';

const reachable = await postgresReachable();
const ben: Actor = { kind: 'user', id: 'u-ben', groups: [] };
const helper: Actor = { kind: 'agent', id: 'helper' };

describe.skipIf(!reachable)('Plattform-Agents gegen Postgres', () => {
  let db: PgFixture;
  let ctx: DomainContext;
  let now = new Date();

  beforeEach(async () => {
    db = await freshDatabase();
    now = new Date();
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
      modelUsage: createModelUsageRepository(db.pool),
      agentProfiles: createAgentProfileRepository(db.pool),
      agentRuns: createAgentRunRepository(db.pool),
      memories: createTeamMemoryStore(db.pool),
      models: scriptedModelSetup(createScriptedModelProvider()),
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
    await createApp(ctx, { actor: admin, name: 'crm', manifest: manifest('crm') });
    await createApp(ctx, { actor: admin, name: 'wiki', manifest: manifest('wiki') });
    await createAgentIdentity(ctx, { actor: admin, name: 'helper' });
    await configureAgent(ctx, { actor: admin, name: 'helper', instructions: 'Help.', maxSteps: 3 });
    await grant(ctx, {
      actor: admin,
      subject: ben,
      verb: 'execute',
      resource: { kind: 'agent', id: 'helper' },
    });
    await db.pool.query(
      `INSERT INTO control_plane."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ('u-ben', 'Ben', 'ben@example.com', true, now(), now())`,
    );
  });

  afterEach(async () => {
    await db.close();
  });

  it('Lauf: warten, genau einmal aufgenommen, ausgefuehrt, Nutzung je Tag gezaehlt', async () => {
    const view = await startAgentRun(ctx, {
      actor: ben,
      email: 'ben@example.com',
      agent: 'helper',
      prompt: 'Hi',
    });
    const [first, second] = await Promise.all([claimAgentRun(ctx), claimAgentRun(ctx)]);
    expect([first?.id, second?.id].filter((id) => id !== undefined)).toEqual([view.id]);
    const finished = await executeAgentRun(ctx, {
      run: (first ?? second)!,
      toolbox: async () => ({
        tools: [],
        call: async () => ({ ok: false, content: '', apps: [] }),
      }),
    });
    expect(finished).toMatchObject({ status: 'succeeded', result: 'done', steps: 1 });
    const since = new Date(now.getTime() - 60_000);
    expect(await ctx.modelUsage!.tokensSince(since)).toBe(15);
    expect(await ctx.modelUsage!.tokensSince(since, { kind: 'agent', id: 'helper' })).toBe(15);
    expect(await ctx.modelUsage!.tokensSince(since, { kind: 'user', id: 'u-ben' })).toBe(0);
  });

  it('dedupe_key: dieselbe Erwaehnung legt keinen zweiten Lauf an', async () => {
    const base = {
      agentName: 'helper',
      triggerKind: 'mention' as const,
      trigger: { kind: 'user' as const, id: 'u-ben', email: 'ben@example.com' },
      source: 'wiki:page:p1',
      sourceApp: 'wiki',
      sourcePath: '/pages/p1',
      prompt: 'mentioned',
      usedApps: ['wiki'],
      dedupeKey: 'wiki:mention.abc:helper',
    };
    expect(await ctx.agentRuns!.create(base)).not.toBeNull();
    expect(await ctx.agentRuns!.create(base)).toBeNull();
  });

  it('ein Lauf mit abgelaufener Frist wird failed (interrupted), nicht neu gestartet', async () => {
    await startAgentRun(ctx, {
      actor: ben,
      email: 'ben@example.com',
      agent: 'helper',
      prompt: 'Hi',
    });
    const claimed = await claimAgentRun(ctx);
    now = new Date(now.getTime() + 16 * 60_000);
    expect(await failInterruptedRuns(ctx)).toBe(1);
    expect(await ctx.agentRuns!.findById(claimed!.id)).toMatchObject({
      status: 'failed',
      errorCode: 'interrupted',
    });
    expect(await claimAgentRun(ctx)).toBeNull();
  });

  it('Gedaechtnis: Herkunft als Teilmenge der lesbaren Apps, forget loescht hart', async () => {
    for (const verb of ['execute'] as const) {
      await grant(ctx, {
        actor: admin,
        subject: helper,
        verb,
        resource: { kind: 'tool', id: 'platform.remember' },
      });
      await grant(ctx, {
        actor: admin,
        subject: helper,
        verb,
        resource: { kind: 'tool', id: 'platform.recall' },
      });
      await grant(ctx, {
        actor: admin,
        subject: ben,
        verb,
        resource: { kind: 'tool', id: 'platform.recall' },
      });
    }
    await grant(ctx, {
      actor: admin,
      subject: ben,
      verb: 'read',
      resource: { kind: 'app', id: 'wiki' },
    });
    const scope = (apps: string[]) => ({
      runId: '00000000-0000-4000-8000-000000000001',
      usedApps: () => apps,
    });
    await remember(ctx, {
      actor: helper,
      text: 'Acme renews in March',
      run: scope(['crm', 'wiki']),
    });
    const wikiOnly = await remember(ctx, {
      actor: helper,
      text: 'Acme wiki page moved',
      run: scope(['wiki']),
    });
    expect((await recall(ctx, { actor: ben, query: 'Acme' })).memories.map((m) => m.id)).toEqual([
      wikiOnly.id,
    ]);
    expect(await ctx.memories!.forget(wikiOnly.id)).toBe(true);
    const { rows } = await db.pool.query('SELECT count(*)::int AS n FROM memories WHERE id = $1', [
      wikiOnly.id,
    ]);
    expect(rows[0]).toEqual({ n: 0 });
  });
});
