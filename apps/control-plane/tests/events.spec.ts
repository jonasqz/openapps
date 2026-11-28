/**
 * Ereignisse, Benachrichtigungen und Abonnements (ADR 0022), ohne Datenbank.
 * Dieselbe Folge gegen Postgres steht in `events-postgres.spec.ts`.
 *
 * Die riskanten Pfade zuerst:
 *
 * - Eine App meldet nur Typen, die ihr Manifest erklaert, und nur mit
 *   Freigabe; jede Ablehnung steht im Audit-Log, das angenommene Ereignis nicht.
 * - Wer die Quell-App nicht lesen darf, bekommt keine Benachrichtigung, und
 *   ein Widerruf blendet sie beim naechsten `list_inbox` aus.
 * - Der Ausloeser bekommt nichts, Gruppen werden zu ihren Mitgliedern von
 *   jetzt.
 * - Ein Abonnent sieht nur mit `read` auf die Quell-App etwas, bekommt ohne
 *   Quittung erneut zugestellt und nach einem Widerruf nichts mehr.
 */

import { beforeEach, describe, expect, it } from 'vitest';
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
  retentionDaysFrom,
  revoke,
  ValidationError,
  type Actor,
  type AppManifest,
  type DomainContext,
} from '../src/domain';
import { runEventRetention } from '../src/infra/event-retention';
import { createMemoryEventRepository } from '../src/infra/memory/events';
import { grantSelfRequests } from '../src/infra/lokal-freigaben';
import { admin, createHarness, manifest, seedBootstrapGrants, type Harness } from './helpers';

const APPS_DOMAIN = 'apps.example.com';

const TASKS: Actor = { kind: 'app', id: 'tasks' };
const MAIL: Actor = { kind: 'app', id: 'mail' };

const anna = { id: 'u-anna', email: 'anna@example.com', name: 'Anna Example' };
const ben = { id: 'u-ben', email: 'ben@example.com', name: 'Ben Example' };
const cleo = { email: 'cleo@example.com' };

const asUser = (user: { id: string }, groups: string[] = []): Actor => ({
  kind: 'user',
  id: user.id,
  groups,
});

function tasksManifest(): AppManifest {
  return {
    ...manifest('tasks'),
    events: [
      { type: 'task.assigned', description: 'A task was assigned.', importance: 'high' },
      { type: 'task.commented', description: 'A comment was added.', importance: 'normal' },
      { type: 'task.archived', description: 'A task was archived.', importance: 'low' },
    ],
    requestedGrants: [
      {
        subjectKind: 'app',
        subjectId: 'tasks',
        verb: 'execute',
        resource: { kind: 'tool', app: 'platform', name: 'emit_event' },
        reason: 'Report events to the platform.',
      },
    ],
  };
}

function mailManifest(): AppManifest {
  return {
    ...manifest('mail'),
    subscriptions: [{ app: 'tasks', type: 'task.assigned' }],
    requestedGrants: [
      {
        subjectKind: 'app',
        subjectId: 'mail',
        verb: 'read',
        resource: { kind: 'app', app: 'tasks' },
        reason: 'Read task events.',
      },
      {
        subjectKind: 'app',
        subjectId: 'mail',
        verb: 'execute',
        resource: { kind: 'tool', app: 'platform', name: 'poll_events' },
        reason: 'Poll.',
      },
      {
        subjectKind: 'app',
        subjectId: 'mail',
        verb: 'execute',
        resource: { kind: 'tool', app: 'platform', name: 'ack_events' },
        reason: 'Ack.',
      },
    ],
  };
}

let counter = 0;
function event(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  counter += 1;
  return {
    id: `e-${String(counter)}`,
    type: 'task.assigned',
    object: 'task:1',
    title: 'Assigned to you: Write the offer',
    path: '/task/1',
    actor: 'human:anna@example.com',
    audience: ['human:ben@example.com'],
    ...overrides,
  };
}

async function grantRead(ctx: DomainContext, subject: Actor | { kind: 'group'; id: string }) {
  return grant(ctx, {
    actor: admin,
    subject: { kind: subject.kind, id: subject.id },
    verb: 'read',
    resource: { kind: 'app', id: 'tasks' },
  });
}

async function tasksMayEmit(ctx: DomainContext) {
  return grant(ctx, {
    actor: admin,
    subject: { kind: 'app', id: 'tasks' },
    verb: 'execute',
    resource: { kind: 'tool', id: 'platform.emit_event' },
  });
}

describe('emit_event: annehmen', () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = createHarness({ appsDomain: APPS_DOMAIN });
    await seedBootstrapGrants(harness);
    await createApp(harness.ctx, { actor: admin, name: 'tasks', manifest: tasksManifest() });
    harness.store.users.add(anna);
    harness.store.users.add(ben);
  });

  it('weist eine App ohne Freigabe ab (403) und protokolliert es', async () => {
    await expect(emitEvent(harness.ctx, { actor: TASKS, args: event() })).rejects.toThrow(
      PermissionDeniedError,
    );
    expect(harness.store.events.storedEvents).toHaveLength(0);
    const entry = harness.store.auditEntries.at(-1);
    expect(entry).toMatchObject({
      action: 'emit_event',
      outcome: 'denied',
      resource: { kind: 'tool', id: 'platform.emit_event' },
    });
  });

  it('weist einen Typ ab, den das Manifest nicht erklaert (400), mit Audit', async () => {
    await tasksMayEmit(harness.ctx);
    await expect(
      emitEvent(harness.ctx, { actor: TASKS, args: event({ type: 'task.deleted' }) }),
    ).rejects.toThrow(ValidationError);
    expect(harness.store.events.storedEvents).toHaveLength(0);
    expect(harness.store.auditEntries.at(-1)).toMatchObject({
      action: 'emit_event',
      outcome: 'error',
      detail: { type: 'task.deleted' },
    });
  });

  it('nimmt ein erklaertes Ereignis an, ohne Audit-Eintrag, und ein Doppel ist duplicate', async () => {
    await tasksMayEmit(harness.ctx);
    const auditBefore = harness.store.auditEntries.length;
    const args = event();
    expect(await emitEvent(harness.ctx, { actor: TASKS, args })).toEqual({ status: 'accepted' });
    expect(await emitEvent(harness.ctx, { actor: TASKS, args })).toEqual({ status: 'duplicate' });
    expect(harness.store.events.storedEvents).toHaveLength(1);
    expect(harness.store.events.storedEvents[0]).toMatchObject({
      app: 'tasks',
      type: 'task.assigned',
      importance: 'high',
    });
    expect(harness.store.auditEntries.length).toBe(auditBefore);
  });

  it('weist Inhalt, fremde Links und Empfaenger in falscher Form ab', async () => {
    await tasksMayEmit(harness.ctx);
    for (const bad of [
      event({ body: 'the whole offer' }),
      event({ path: 'https://evil.invalid/' }),
      event({ audience: ['app:crm'] }),
    ]) {
      await expect(emitEvent(harness.ctx, { actor: TASKS, args: bad })).rejects.toThrow(
        ValidationError,
      );
    }
  });

  it('nimmt von einem Menschen oder Agenten nichts an, auch mit Freigabe', async () => {
    await grant(harness.ctx, {
      actor: admin,
      subject: { kind: 'agent', id: 'helper' },
      verb: 'execute',
      resource: { kind: 'tool', id: 'platform.emit_event' },
    });
    await expect(
      emitEvent(harness.ctx, { actor: { kind: 'agent', id: 'helper' }, args: event() }),
    ).rejects.toThrow(PermissionDeniedError);
  });
});

describe('Benachrichtigungen: ableiten und lesen', () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = createHarness({ appsDomain: APPS_DOMAIN });
    await seedBootstrapGrants(harness);
    await createApp(harness.ctx, { actor: admin, name: 'tasks', manifest: tasksManifest() });
    harness.store.users.add(anna);
    harness.store.users.add(ben);
    await tasksMayEmit(harness.ctx);
  });

  const inboxOf = (user: { id: string; email: string }, groups: string[] = []) =>
    listInbox(harness.ctx, { actor: asUser(user, groups), email: user.email });

  it('gibt nur der Person eine Zeile, die die Quell-App lesen darf', async () => {
    await grantRead(harness.ctx, asUser(ben));
    await emitEvent(harness.ctx, {
      actor: TASKS,
      args: event({ actor: 'app:tasks', audience: ['human:anna@example.com', 'user:u-ben'] }),
    });
    // Anna hat keine Freigabe: keine Zeile, auch nicht ausgeblendet.
    const owners = harness.store.events.storedNotifications.map((n) => n.owner.id);
    expect(owners).toEqual(['ben@example.com']);
    expect((await inboxOf(ben)).items.map((item) => item.title)).toEqual([
      'Assigned to you: Write the offer',
    ]);
    expect((await inboxOf(anna)).items).toEqual([]);
  });

  it('blendet nach einem Widerruf beim naechsten list_inbox aus, ohne zu loeschen', async () => {
    const read = await grantRead(harness.ctx, asUser(ben));
    await emitEvent(harness.ctx, { actor: TASKS, args: event() });
    expect((await inboxOf(ben)).items).toHaveLength(1);
    expect((await inboxOf(ben)).unread).toBe(1);

    await revoke(harness.ctx, { actor: admin, grantId: read.id });
    const after = await inboxOf(ben);
    expect(after.items).toEqual([]);
    expect(after.unread).toBe(0);
    expect(after.apps).toEqual([]);
    expect(harness.store.events.storedNotifications).toHaveLength(1);
    // Auch markieren geht nicht mehr.
    const id = harness.store.events.storedNotifications[0]?.id ?? '';
    expect(
      await markInbox(harness.ctx, {
        actor: asUser(ben),
        email: ben.email,
        ids: [id],
        state: 'done',
      }),
    ).toEqual({ updated: 0 });
  });

  it('loest eine Gruppe zu ihren Mitgliedern von jetzt auf, ohne den Ausloeser', async () => {
    await createGroup(harness.ctx, { actor: admin, name: 'sales' });
    for (const email of [anna.email, ben.email, cleo.email]) {
      await addGroupMember(harness.ctx, { actor: admin, group: 'sales', email });
    }
    await grantRead(harness.ctx, { kind: 'group', id: 'sales' });
    await emitEvent(harness.ctx, {
      actor: TASKS,
      args: event({ actor: 'user:u-anna', audience: ['group:sales'] }),
    });
    const owners = harness.store.events.storedNotifications.map((n) => n.owner.id).sort();
    // Cleo hat sich nie angemeldet und bekommt trotzdem eine Zeile.
    expect(owners).toEqual(['ben@example.com', 'cleo@example.com']);

    // Wer spaeter dazukommt, sieht aeltere Ereignisse nicht.
    await addGroupMember(harness.ctx, { actor: admin, group: 'sales', email: 'dora@example.com' });
    const dora = { id: 'u-dora', email: 'dora@example.com' };
    expect((await inboxOf(dora, ['sales'])).items).toEqual([]);
    const benItems = (await inboxOf(ben, ['sales'])).items;
    expect(benItems[0]).toMatchObject({
      via: 'group',
      viaGroup: 'sales',
      actorLabel: 'Anna Example',
    });
  });

  it('ordnet direkt vor Gruppe, dann nach Wichtigkeit, dann neueste zuerst', async () => {
    await createGroup(harness.ctx, { actor: admin, name: 'sales' });
    await addGroupMember(harness.ctx, { actor: admin, group: 'sales', email: ben.email });
    await grantRead(harness.ctx, asUser(ben));
    const emit = (args: Record<string, unknown>) => emitEvent(harness.ctx, { actor: TASKS, args });
    await emit(
      event({ title: 'group high', audience: ['group:sales'], occurredAt: '2026-11-01T10:00:00Z' }),
    );
    await emit(
      event({ type: 'task.archived', title: 'direct low', occurredAt: '2026-11-03T10:00:00Z' }),
    );
    await emit(
      event({
        type: 'task.commented',
        title: 'direct normal old',
        occurredAt: '2026-11-01T10:00:00Z',
      }),
    );
    await emit(
      event({
        type: 'task.commented',
        title: 'direct normal new',
        occurredAt: '2026-11-02T10:00:00Z',
      }),
    );
    const titles = (await inboxOf(ben, ['sales'])).items.map((item) => item.title);
    expect(titles).toEqual(['direct normal new', 'direct normal old', 'direct low', 'group high']);
  });

  it('markiert nur eigene Zeilen und filtert nach Zustand und App', async () => {
    await grantRead(harness.ctx, asUser(ben));
    await grantRead(harness.ctx, asUser(anna));
    await emitEvent(harness.ctx, {
      actor: TASKS,
      args: event({ actor: null, audience: ['human:ben@example.com', 'human:anna@example.com'] }),
    });
    const benItem = (await inboxOf(ben)).items[0];
    const annaItem = (await inboxOf(anna)).items[0];
    expect(benItem).toBeDefined();
    const marked = await markInbox(harness.ctx, {
      actor: asUser(ben),
      email: ben.email,
      ids: [benItem?.id ?? '', annaItem?.id ?? ''],
      state: 'done',
    });
    expect(marked).toEqual({ updated: 1 });
    expect((await inboxOf(ben)).items).toEqual([]);
    expect(
      (await listInbox(harness.ctx, { actor: asUser(ben), email: ben.email, state: 'done' })).items,
    ).toHaveLength(1);
    expect((await inboxOf(anna)).items[0]?.state).toBe('unread');
    // Ein Filter auf eine App, die es nicht gibt oder die man nicht liest: leer.
    expect(
      (await listInbox(harness.ctx, { actor: asUser(ben), email: ben.email, app: 'crm' })).items,
    ).toEqual([]);
  });

  it('gibt einem Agenten einen Eingang, einem gesperrten nicht', async () => {
    await grant(harness.ctx, {
      actor: admin,
      subject: { kind: 'agent', id: 'helper' },
      verb: 'read',
      resource: { kind: 'app', id: 'tasks' },
    });
    // Ohne Identitaet zaehlt die Freigabe nicht.
    await emitEvent(harness.ctx, { actor: TASKS, args: event({ audience: ['agent:helper'] }) });
    expect(harness.store.events.storedNotifications).toHaveLength(0);

    await harness.store.agents.create({
      name: 'helper',
      displayName: 'Helper',
      ownerUserId: 'u-admin',
      oauthClientId: 'c-helper',
      oauthClientSecretHash: 'x',
    });
    await emitEvent(harness.ctx, { actor: TASKS, args: event({ audience: ['agent:helper'] }) });
    const items = (await listInbox(harness.ctx, { actor: { kind: 'agent', id: 'helper' } })).items;
    expect(items).toHaveLength(1);
    expect(items[0]?.href).toBe('https://apps.example.com/tasks/task/1');
  });

  it('hat keinen Eingang fuer Apps und keinen fuer Menschen ohne E-Mail', async () => {
    await expect(listInbox(harness.ctx, { actor: TASKS })).rejects.toThrow(PermissionDeniedError);
    await expect(listInbox(harness.ctx, { actor: asUser(ben) })).rejects.toThrow(
      PermissionDeniedError,
    );
  });

  it('prueft die Eingaben von mark_inbox und list_inbox', async () => {
    const caller = { actor: asUser(ben), email: ben.email };
    await expect(markInbox(harness.ctx, { ...caller, ids: ['x'], state: 'done' })).rejects.toThrow(
      ValidationError,
    );
    await expect(markInbox(harness.ctx, { ...caller, ids: [], state: 'done' })).rejects.toThrow(
      ValidationError,
    );
    await expect(
      markInbox(harness.ctx, {
        ...caller,
        ids: ['00000000-0000-4000-8000-000000000001'],
        state: 'gone',
      }),
    ).rejects.toThrow(ValidationError);
    await expect(listInbox(harness.ctx, { ...caller, state: 'constructor' })).rejects.toThrow(
      ValidationError,
    );
    await expect(listInbox(harness.ctx, { ...caller, limit: 1000 })).rejects.toThrow(
      ValidationError,
    );
  });
});

describe('Abonnements: poll_events und ack_events', () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = createHarness({ appsDomain: APPS_DOMAIN });
    await seedBootstrapGrants(harness);
    await createApp(harness.ctx, { actor: admin, name: 'tasks', manifest: tasksManifest() });
    await createApp(harness.ctx, { actor: admin, name: 'mail', manifest: mailManifest() });
    await tasksMayEmit(harness.ctx);
    for (const tool of ['poll_events', 'ack_events']) {
      await grant(harness.ctx, {
        actor: admin,
        subject: { kind: 'app', id: 'mail' },
        verb: 'execute',
        resource: { kind: 'tool', id: `platform.${tool}` },
      });
    }
  });

  it('liefert ohne read auf die Quell-App nichts, mit Freigabe alles, auch ohne audience', async () => {
    await emitEvent(harness.ctx, { actor: TASKS, args: event({ audience: [] }) });
    await emitEvent(harness.ctx, { actor: TASKS, args: event({ type: 'task.commented' }) });
    await emitEvent(harness.ctx, { actor: TASKS, args: event() });

    expect((await pollEvents(harness.ctx, { actor: MAIL })).events).toEqual([]);

    const read = await grantRead(harness.ctx, MAIL);
    const events = (await pollEvents(harness.ctx, { actor: MAIL })).events;
    // Nur der abonnierte Typ, in Reihenfolge, ohne die Empfaengerliste.
    expect(events.map((e) => e.type)).toEqual(['task.assigned', 'task.assigned']);
    expect(events[0]).not.toHaveProperty('audience');

    // Ohne Quittung kommt dasselbe wieder.
    expect((await pollEvents(harness.ctx, { actor: MAIL })).events).toHaveLength(2);
    await ackEvents(harness.ctx, { actor: MAIL, upTo: events[0]?.seq ?? 0 });
    expect((await pollEvents(harness.ctx, { actor: MAIL })).events.map((e) => e.seq)).toEqual([
      events[1]?.seq,
    ]);

    // Nach dem Widerruf nichts mehr, und die Quittung bewegt nichts.
    await revoke(harness.ctx, { actor: admin, grantId: read.id });
    await emitEvent(harness.ctx, { actor: TASKS, args: event() });
    expect((await pollEvents(harness.ctx, { actor: MAIL })).events).toEqual([]);
    expect(await ackEvents(harness.ctx, { actor: MAIL, upTo: 1 })).toEqual({ acknowledged: 0 });
  });

  it('braucht die Freigaben auf poll_events und ack_events', async () => {
    const other = { kind: 'app' as const, id: 'tasks' };
    await expect(pollEvents(harness.ctx, { actor: other })).rejects.toThrow(PermissionDeniedError);
    await expect(ackEvents(harness.ctx, { actor: other, upTo: 0 })).rejects.toThrow(
      PermissionDeniedError,
    );
  });

  it('quittiert nicht ueber das letzte Ereignis hinaus', async () => {
    await grantRead(harness.ctx, MAIL);
    await emitEvent(harness.ctx, { actor: TASKS, args: event() });
    await expect(ackEvents(harness.ctx, { actor: MAIL, upTo: 99 })).rejects.toThrow(
      ValidationError,
    );
    await expect(ackEvents(harness.ctx, { actor: MAIL, upTo: -1 })).rejects.toThrow(
      ValidationError,
    );
  });
});

describe('Freigaben auf Plattform-Tools', () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = createHarness({ appsDomain: APPS_DOMAIN });
    await seedBootstrapGrants(harness);
    await createApp(harness.ctx, { actor: admin, name: 'tasks', manifest: tasksManifest() });
  });

  it('vergibt nur die Plattform-Administration, und nur bekannte Tools', async () => {
    const someone: Actor = { kind: 'user', id: 'u-x', groups: [] };
    await expect(
      grant(harness.ctx, {
        actor: someone,
        subject: { kind: 'app', id: 'tasks' },
        verb: 'execute',
        resource: { kind: 'tool', id: 'platform.emit_event' },
      }),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
      grant(harness.ctx, {
        actor: admin,
        subject: { kind: 'app', id: 'tasks' },
        verb: 'execute',
        resource: { kind: 'tool', id: 'platform.list_inbox' },
      }),
    ).rejects.toThrow(/no tool/);
  });

  it('erteilt lokal den Antrag einer App fuer sich selbst', async () => {
    const results = await grantSelfRequests(harness.ctx, admin, [tasksManifest()], () => undefined);
    expect(results).toEqual([
      { label: 'app:tasks execute tool:platform.emit_event', outcome: 'granted' },
    ]);
    await expect(
      emitEvent(harness.ctx, { actor: TASKS, args: event({ audience: [] }) }),
    ).resolves.toEqual({ status: 'accepted' });
  });
});

describe('Aufbewahrung', () => {
  it('loescht, was aelter als die Frist ist, und laesst Juengeres', async () => {
    let now = new Date('2026-08-01T00:00:00Z');
    const harness = createHarness({ appsDomain: APPS_DOMAIN });
    const events = createMemoryEventRepository({ now: () => now });
    const ctx: DomainContext = { ...harness.ctx, events, clock: { now: () => now } };
    await seedBootstrapGrants(harness);
    await createApp(ctx, { actor: admin, name: 'tasks', manifest: tasksManifest() });
    await tasksMayEmit(ctx);
    harness.store.users.add(ben);
    await grantRead(ctx, asUser(ben));

    await emitEvent(ctx, { actor: TASKS, args: event({ occurredAt: now.toISOString() }) });
    now = new Date('2026-10-01T00:00:00Z');
    await emitEvent(ctx, { actor: TASKS, args: event({ occurredAt: now.toISOString() }) });
    now = new Date('2026-11-15T00:00:00Z');

    const removed = await purgeExpiredEvents(ctx, { retentionDays: 90 });
    expect(removed).toMatchObject({ events: 1, notifications: 1 });
    expect(events.storedEvents.map((e) => e.receivedAt.toISOString())).toEqual([
      '2026-10-01T00:00:00.000Z',
    ]);
    expect(events.storedNotifications).toHaveLength(1);
  });

  it('liest die Frist aus der Env: Default 90, sonst ganze Tage', () => {
    expect(retentionDaysFrom(undefined)).toBe(90);
    expect(retentionDaysFrom(' ')).toBe(90);
    expect(retentionDaysFrom('30')).toBe(30);
    for (const bad of ['0', '-1', '1.5', 'ninety', '99999']) {
      expect(() => retentionDaysFrom(bad), bad).toThrow();
    }
  });
});

describe('Gesperrte App-Namen und Loeschlauf', () => {
  it('legt keine neue App mit einem Namen der Plattform an', async () => {
    const harness = createHarness({ appsDomain: APPS_DOMAIN });
    await seedBootstrapGrants(harness);
    for (const name of ['platform', 'human', 'group', 'agent', 'app']) {
      await expect(
        createApp(harness.ctx, { actor: admin, name, manifest: manifest(name) }),
        name,
      ).rejects.toThrow(/reserved/);
    }
  });

  it('loescht bei einer unbrauchbaren Frist nichts und meldet es laut', async () => {
    const harness = createHarness({ appsDomain: APPS_DOMAIN });
    const lines: string[] = [];
    const log = { info: (l: string) => lines.push(l), error: (l: string) => lines.push(l) };
    expect(
      await runEventRetention(harness.ctx, { OPENAPPS_EVENTS_RETENTION_DAYS: 'forever' }, log),
    ).toBeNull();
    expect(lines[0]).toMatch(/^ALARM event retention not run/);
    expect(await runEventRetention(harness.ctx, {}, log)).toEqual({ events: 0, notifications: 0 });
  });
});
