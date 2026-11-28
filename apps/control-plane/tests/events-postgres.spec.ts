/**
 * ADR 0022, Schritte 1, 2, 5 und 6 gegen Postgres (Migrationen 0017 bis
 * 0019). Dieselbe Folge wie `events.spec.ts`, aber mit den echten
 * Repositories: Doppel ueber den Unique-Index, Benachrichtigungen in derselben
 * Transaktion, Cursor nur vorwaerts, Loeschen mit Kaskade.
 *
 * Laeuft gegen die Instanz aus `docker-compose.yml`; ist sie nicht
 * erreichbar, ueberspringt sie sich.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ackEvents,
  addGroupMember,
  createApp,
  createGroup,
  emitEvent,
  grant,
  listInbox,
  markInbox,
  PermissionDeniedError,
  pollEvents,
  purgeExpiredEvents,
  revoke,
  uuidIds,
  ValidationError,
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
  createUserDirectory,
} from '../src/infra/pg';
import { freshDatabase, postgresReachable, type PgFixture } from './pg-helpers';
import { admin, manifest, testGatewaySettings, TEST_MASTER_SECRET } from './helpers';

const reachable = await postgresReachable();

const TASKS: Actor = { kind: 'app', id: 'tasks' };
const MAIL: Actor = { kind: 'app', id: 'mail' };
const ben: Actor = { kind: 'user', id: 'u-ben', groups: [] };

function tasksManifest(): AppManifest {
  return {
    ...manifest('tasks'),
    events: [
      { type: 'task.assigned', description: 'Assigned.', importance: 'high' },
      { type: 'task.commented', description: 'Commented.', importance: 'normal' },
    ],
  };
}

let counter = 0;
const event = (overrides: Record<string, unknown> = {}) => {
  counter += 1;
  return {
    id: `pg-${String(counter)}`,
    type: 'task.assigned',
    object: 'task:1',
    title: 'Assigned to you',
    path: '/task/1',
    actor: 'human:anna@example.com',
    audience: ['human:ben@example.com', 'human:anna@example.com'],
    ...overrides,
  };
};

describe.skipIf(!reachable)('Ereignisse gegen Postgres', () => {
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
    await createApp(ctx, { actor: admin, name: 'tasks', manifest: tasksManifest() });
    await createApp(ctx, {
      actor: admin,
      name: 'mail',
      manifest: { ...manifest('mail'), subscriptions: [{ app: 'tasks', type: 'task.assigned' }] },
    });
    // Zwei Personen, die sich schon angemeldet haben (Better Auth, 0008).
    for (const [id, email] of [
      ['u-ben', 'ben@example.com'],
      ['u-anna', 'anna@example.com'],
    ] as const) {
      await db.pool.query(
        `INSERT INTO control_plane."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, true, now(), now())`,
        [id, id, email],
      );
    }
  });

  afterEach(async () => {
    await db.close();
  });

  const mayEmit = () =>
    grant(ctx, {
      actor: admin,
      subject: { kind: 'app', id: 'tasks' },
      verb: 'execute',
      resource: { kind: 'tool', id: 'platform.emit_event' },
    });
  const readTasks = (subject: { kind: 'user' | 'group' | 'app'; id: string }) =>
    grant(ctx, { actor: admin, subject, verb: 'read', resource: { kind: 'app', id: 'tasks' } });

  it('nimmt an, erkennt Doppel, weist nicht Erklaertes und fehlende Freigabe ab', async () => {
    await expect(emitEvent(ctx, { actor: TASKS, args: event() })).rejects.toThrow(
      PermissionDeniedError,
    );
    await mayEmit();
    const args = event();
    expect(await emitEvent(ctx, { actor: TASKS, args })).toEqual({ status: 'accepted' });
    expect(await emitEvent(ctx, { actor: TASKS, args })).toEqual({ status: 'duplicate' });
    await expect(
      emitEvent(ctx, { actor: TASKS, args: event({ type: 'task.deleted' }) }),
    ).rejects.toThrow(ValidationError);

    const { rows } = await db.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM events');
    expect(rows[0]?.n).toBe(1);
    const audit = await db.pool.query<{ action: string; outcome: string }>(
      `SELECT action, outcome::text AS outcome FROM audit_log
        WHERE action = 'emit_event' ORDER BY occurred_at`,
    );
    expect(audit.rows.map((r) => r.outcome)).toEqual(['denied', 'error']);
  });

  it('leitet nur fuer Leser ab, ohne Ausloeser, und ein Widerruf wirkt beim naechsten Lesen', async () => {
    await mayEmit();
    const read = await readTasks({ kind: 'user', id: 'u-ben' });
    await readTasks({ kind: 'user', id: 'u-anna' });
    await emitEvent(ctx, { actor: TASKS, args: event() });

    const owners = await db.pool.query<{ owner_id: string }>(
      'SELECT owner_id FROM notifications ORDER BY owner_id',
    );
    // Anna hat ausgeloest und bekommt nichts.
    expect(owners.rows.map((r) => r.owner_id)).toEqual(['ben@example.com']);

    const inbox = await listInbox(ctx, { actor: ben, email: 'ben@example.com' });
    expect(inbox.items).toHaveLength(1);
    expect(inbox.unread).toBe(1);
    const id = inbox.items[0]?.id ?? '';
    expect(
      await markInbox(ctx, { actor: ben, email: 'ben@example.com', ids: [id], state: 'read' }),
    ).toEqual({ updated: 1 });

    await revoke(ctx, { actor: admin, grantId: read.id });
    expect((await listInbox(ctx, { actor: ben, email: 'ben@example.com' })).items).toEqual([]);
    const kept = await db.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM notifications');
    expect(kept.rows[0]?.n).toBe(1);
  });

  it('loest Gruppen zu ihren Mitgliedern auf, auch ohne Anmeldung', async () => {
    await mayEmit();
    await createGroup(ctx, { actor: admin, name: 'sales' });
    await addGroupMember(ctx, { actor: admin, group: 'sales', email: 'cleo@example.com' });
    await addGroupMember(ctx, { actor: admin, group: 'sales', email: 'ben@example.com' });
    await readTasks({ kind: 'group', id: 'sales' });
    await emitEvent(ctx, {
      actor: TASKS,
      args: event({ audience: ['group:sales', 'user:u-ben'] }),
    });
    const rows = await db.pool.query<{ owner_id: string; via: string }>(
      'SELECT owner_id, via FROM notifications ORDER BY owner_id',
    );
    expect(rows.rows).toEqual([
      { owner_id: 'ben@example.com', via: 'direct' },
      { owner_id: 'cleo@example.com', via: 'group' },
    ]);
  });

  it('stellt Abonnenten nur mit read zu, erneut ohne Quittung, nicht nach Widerruf', async () => {
    await mayEmit();
    for (const tool of ['poll_events', 'ack_events']) {
      await grant(ctx, {
        actor: admin,
        subject: { kind: 'app', id: 'mail' },
        verb: 'execute',
        resource: { kind: 'tool', id: `platform.${tool}` },
      });
    }
    await emitEvent(ctx, { actor: TASKS, args: event() });
    await emitEvent(ctx, { actor: TASKS, args: event({ type: 'task.commented' }) });
    await emitEvent(ctx, { actor: TASKS, args: event() });
    expect((await pollEvents(ctx, { actor: MAIL })).events).toEqual([]);

    const read = await readTasks({ kind: 'app', id: 'mail' });
    const first = (await pollEvents(ctx, { actor: MAIL })).events;
    expect(first.map((e) => e.type)).toEqual(['task.assigned', 'task.assigned']);
    expect((await pollEvents(ctx, { actor: MAIL })).events).toHaveLength(2);
    await ackEvents(ctx, { actor: MAIL, upTo: first[0]?.seq ?? 0 });
    // Rueckwaerts quittieren bewegt den Cursor nicht zurueck.
    await ackEvents(ctx, { actor: MAIL, upTo: 0 });
    expect((await pollEvents(ctx, { actor: MAIL })).events.map((e) => e.seq)).toEqual([
      first[1]?.seq,
    ]);

    await revoke(ctx, { actor: admin, grantId: read.id });
    expect((await pollEvents(ctx, { actor: MAIL })).events).toEqual([]);
  });

  it('loescht nach der Frist hart, mit den Benachrichtigungen, und laesst Juengeres', async () => {
    await mayEmit();
    await readTasks({ kind: 'user', id: 'u-ben' });
    await emitEvent(ctx, { actor: TASKS, args: event() });
    await emitEvent(ctx, { actor: TASKS, args: event() });
    await db.pool.query(
      `UPDATE events SET received_at = now() - interval '91 days'
        WHERE seq = (SELECT min(seq) FROM events)`,
    );
    const removed = await purgeExpiredEvents(ctx, { retentionDays: 90 });
    expect(removed).toMatchObject({ events: 1, notifications: 1 });
    const left = await db.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM notifications');
    expect(left.rows[0]?.n).toBe(1);
  });
});
