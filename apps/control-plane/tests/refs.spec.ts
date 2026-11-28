/**
 * Verweise zwischen Apps (ADR 0023), ohne Datenbank. Dieselbe Folge fuer
 * `set_refs` gegen Postgres steht in `refs-postgres.spec.ts`.
 *
 * Die riskanten Pfade zuerst:
 *
 * - Wer die Ziel-App nicht lesen darf, bekommt `restricted`, ohne Titel und
 *   ohne App-Namen, auch fuer eine App, die es nicht gibt.
 * - Ein Widerruf wirkt beim naechsten Aufruf, auch mit Cache; ein neuer
 *   Titel spaetestens nach 60 s, ohne Cache sofort.
 * - Eine App meldet Verweise nur fuer eigene Objekte und nur mit Freigabe.
 * - Rueckverweise und Erwaehnungen nur fuer Subjekte mit `read`.
 * - Der Picker zeigt nur Subjekte mit `read` auf dieselbe App.
 * - Aktionen nur mit `execute` (Agent) bzw. Lesezugriff (Mensch).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  addGroupMember,
  createAgentIdentity,
  createApp,
  createGroup,
  createRefCache,
  disableAgentIdentity,
  federateSearch,
  grant,
  listActions,
  listBacklinks,
  listInbox,
  listPeople,
  PermissionDeniedError,
  resolveRefs,
  revoke,
  setRefs,
  ValidationError,
  type Actor,
  type AppManifest,
  type AppToolInvoker,
  type DomainContext,
  type HumanIdentity,
  type ResolvedObjectRef,
} from '../src/domain';
import { grantSelfRequests } from '../src/infra/lokal-freigaben';
import { admin, createHarness, manifest, seedBootstrapGrants, type Harness } from './helpers';

const APPS_DOMAIN = 'apps.example.com';
const START = Date.parse('2026-11-28T10:00:00.000Z');

const anna = { id: 'u-anna', email: 'anna@example.com', name: 'Anna Example' };
const ben = { id: 'u-ben', email: 'ben@example.com', name: 'Ben Example' };
const cleo = { id: 'u-cleo', email: 'cleo@example.com', name: '' };

const asUser = (user: { id: string }, groups: string[] = []): Actor => ({
  kind: 'user',
  id: user.id,
  groups,
});
const identityOf = (user: { id: string; email: string }, groups: string[] = []): HumanIdentity => ({
  userId: user.id,
  email: user.email,
  groups,
});
const WIKI: Actor = { kind: 'app', id: 'wiki' };
const TASKS: Actor = { kind: 'app', id: 'tasks' };
const helper: Actor = { kind: 'agent', id: 'helper' };

function tasksManifest(): AppManifest {
  const base = manifest('tasks');
  return {
    ...base,
    offeredTools: [
      ...base.offeredTools,
      { name: 'resolve', description: 'Resolve.', verb: 'read', operationId: 'resolve' },
      {
        name: 'tasks.create_from_ref',
        description: 'Create from ref.',
        verb: 'write',
        operationId: 'createFromRef',
      },
      { name: 'search', description: 'Search.', verb: 'read', operationId: 'search' },
    ],
    search: { tool: 'search' },
    objects: [
      { type: 'task', description: 'A task.', resolver: 'resolve' },
      { type: 'project', description: 'A project.', resolver: 'resolve' },
    ],
    actions: [
      {
        name: 'task_from_ref',
        title: 'Create task',
        accepts: ['wiki:page', 'crm:deal'],
        tool: 'tasks.create_from_ref',
        path: '/new',
      },
    ],
    requestedGrants: [
      {
        subjectKind: 'app',
        subjectId: 'tasks',
        verb: 'execute',
        resource: { kind: 'tool', app: 'platform', name: 'set_refs' },
        reason: 'Report references.',
      },
    ],
  };
}

function wikiManifest(): AppManifest {
  const base = manifest('wiki');
  return {
    ...base,
    offeredTools: [
      ...base.offeredTools,
      { name: 'pages.resolve', description: 'Resolve.', verb: 'read', operationId: 'resolve' },
    ],
    objects: [{ type: 'page', description: 'A page.', resolver: 'pages.resolve' }],
    requestedGrants: [
      {
        subjectKind: 'app',
        subjectId: 'wiki',
        verb: 'execute',
        resource: { kind: 'tool', app: 'platform', name: 'set_refs' },
        reason: 'Report references and mentions.',
      },
    ],
  };
}

/** Eine App im Test: Titel je Id, und was sie gefragt wurde, mit wessen Identitaet. */
function fakeApps(): AppToolInvoker & {
  readonly titles: Map<string, string>;
  readonly calls: { app: string; tool: string; ids: string[]; who: string }[];
  failing: Set<string>;
  hanging: Set<string>;
} {
  const titles = new Map<string, string>([
    ['tasks:task:42', 'Write the offer'],
    ['tasks:project:p1', 'Launch'],
    ['wiki:page:p1', 'Meeting notes'],
  ]);
  const calls: { app: string; tool: string; ids: string[]; who: string }[] = [];
  const self = {
    titles,
    calls,
    failing: new Set<string>(),
    hanging: new Set<string>(),
    async invoke({
      app,
      toolName,
      actor,
      args,
      humanIdentity,
      signal,
    }: Parameters<AppToolInvoker['invoke']>[0]) {
      const ids = (args.ids as string[]) ?? [];
      calls.push({
        app: app.name,
        tool: toolName,
        ids,
        who: humanIdentity?.email ?? `${actor.kind}:${actor.id}`,
      });
      if (self.failing.has(app.name)) throw new Error('boom');
      if (self.hanging.has(app.name)) {
        await new Promise((_, reject) =>
          signal?.addEventListener('abort', () => reject(new Error('aborted'))),
        );
      }
      return {
        objects: ids
          .filter((id) => titles.has(`${app.name}:${String(args.type)}:${id}`))
          .map((id) => ({
            id,
            title: titles.get(`${app.name}:${String(args.type)}:${id}`),
            path: `/${String(args.type)}/${id}`,
            status: 'Open',
            updatedAt: new Date(START).toISOString(),
          })),
      };
    },
  };
  return self;
}

interface World {
  harness: Harness;
  ctx: DomainContext;
  clock: { now: number };
  apps: ReturnType<typeof fakeApps>;
}

async function world(): Promise<World> {
  const harness = createHarness({ appsDomain: APPS_DOMAIN });
  const clock = { now: START };
  const ctx: DomainContext = { ...harness.ctx, clock: { now: () => new Date(clock.now) } };
  await seedBootstrapGrants(harness);
  await createApp(ctx, { actor: admin, name: 'tasks', manifest: tasksManifest() });
  await createApp(ctx, { actor: admin, name: 'wiki', manifest: wikiManifest() });
  for (const user of [anna, ben, cleo]) harness.store.users.add(user);
  return { harness, ctx, clock, apps: fakeApps() };
}

const grantRead = (
  ctx: DomainContext,
  subject: { kind: Actor['kind'] | 'group'; id: string },
  app: string,
) =>
  grant(ctx, {
    actor: admin,
    subject: { kind: subject.kind, id: subject.id },
    verb: 'read',
    resource: { kind: 'app', id: app },
  });

const grantTool = (ctx: DomainContext, subject: Actor, tool: string) =>
  grant(ctx, {
    actor: admin,
    subject: { kind: subject.kind, id: subject.id },
    verb: 'execute',
    resource: { kind: 'tool', id: tool },
  });

/* -------------------------------------------------------------------------- */

describe('resolve_refs: Rechte vor jedem Titel', () => {
  let w: World;
  beforeEach(async () => {
    w = await world();
  });

  const resolveAs = (
    user: { id: string; email: string },
    refs: string[],
    cache = undefined as ReturnType<typeof createRefCache> | undefined,
  ) =>
    resolveRefs(w.ctx, {
      actor: asUser(user),
      humanIdentity: identityOf(user),
      refs,
      invoker: w.apps,
      ...(cache === undefined ? {} : { cache }),
    });

  it('zwei Betrachter: mit read aufgeloest, ohne restricted ohne Titel und ohne App-Namen', async () => {
    await grantRead(w.ctx, asUser(anna), 'tasks');
    const withRead = await resolveAs(anna, ['tasks:task:42']);
    expect(withRead.results[0]).toMatchObject({
      ref: 'tasks:task:42',
      state: 'resolved',
      title: 'Write the offer',
      app: 'tasks',
      href: 'https://apps.example.com/tasks/task/42',
    });
    // Die App sah die Person selbst, nicht die Plattform.
    expect(w.apps.calls.at(-1)?.who).toBe('anna@example.com');

    const calls = w.apps.calls.length;
    const without = await resolveAs(ben, ['tasks:task:42']);
    expect(without.results).toEqual([{ ref: 'tasks:task:42', state: 'restricted' }]);
    // Ohne Recht wird die App gar nicht gefragt.
    expect(w.apps.calls.length).toBe(calls);
  });

  it('eine App, die es nicht gibt, ist restricted wie eine ohne Recht', async () => {
    const result = await resolveAs(anna, ['mail:message:1', 'tasks:task:42']);
    expect(result.results).toEqual([
      { ref: 'mail:message:1', state: 'restricted' },
      { ref: 'tasks:task:42', state: 'restricted' },
    ]);
  });

  it('Widerruf wirkt beim naechsten Aufruf, auch wenn der Cache den Titel noch haelt', async () => {
    const cache = createRefCache();
    const read = await grantRead(w.ctx, asUser(anna), 'tasks');
    expect((await resolveAs(anna, ['tasks:task:42'], cache)).results[0]?.state).toBe('resolved');
    await revoke(w.ctx, { actor: admin, grantId: read.id });
    expect((await resolveAs(anna, ['tasks:task:42'], cache)).results[0]).toEqual({
      ref: 'tasks:task:42',
      state: 'restricted',
    });
  });

  it('ein neuer Titel erscheint mit Cache spaetestens nach 60 s, ohne Cache sofort', async () => {
    const cache = createRefCache();
    await grantRead(w.ctx, asUser(anna), 'tasks');
    const title = async (useCache: boolean) =>
      (
        (await resolveAs(anna, ['tasks:task:42'], useCache ? cache : undefined))
          .results[0] as ResolvedObjectRef
      ).title;

    expect(await title(true)).toBe('Write the offer');
    w.apps.titles.set('tasks:task:42', 'Send the offer');
    expect(await title(true)).toBe('Write the offer');
    expect(await title(false)).toBe('Send the offer');
    w.clock.now += 59_000;
    expect(await title(true)).toBe('Write the offer');
    w.clock.now += 1_000;
    expect(await title(true)).toBe('Send the offer');
  });

  it('Resolver aus, kaputt oder zu langsam ergibt unavailable; fehlend not_found', async () => {
    await grantRead(w.ctx, asUser(anna), 'tasks');
    await grantRead(w.ctx, asUser(anna), 'wiki');
    w.apps.failing.add('tasks');
    w.apps.hanging.add('wiki');
    const result = await resolveRefs(w.ctx, {
      actor: asUser(anna),
      humanIdentity: identityOf(anna),
      refs: ['tasks:task:42', 'wiki:page:p1', 'tasks:comment:1', 'nonsense'],
      invoker: w.apps,
      timeoutMs: 20,
    });
    expect(result.results.map((r) => r.state)).toEqual([
      'unavailable',
      'unavailable',
      'not_found',
      'not_found',
    ]);
    w.apps.failing.clear();
    expect((await resolveAs(anna, ['tasks:task:404'])).results[0]).toEqual({
      ref: 'tasks:task:404',
      state: 'not_found',
    });
  });

  it('ein Agent braucht read auf die App und execute auf den Resolver', async () => {
    await grantRead(w.ctx, helper, 'tasks');
    const run = () =>
      resolveRefs(w.ctx, { actor: helper, refs: ['tasks:task:42'], invoker: w.apps });
    expect((await run()).results[0]?.state).toBe('restricted');
    await grantTool(w.ctx, helper, 'tasks.resolve');
    expect((await run()).results[0]).toMatchObject({ state: 'resolved', title: 'Write the offer' });
    expect(w.apps.calls.at(-1)?.who).toBe('agent:helper');
  });

  it('eine Person nur mit eigener Sitzung; Apps loesen nichts auf', async () => {
    await expect(
      resolveRefs(w.ctx, {
        actor: asUser(anna),
        humanIdentity: identityOf(ben),
        refs: ['tasks:task:42'],
        invoker: w.apps,
      }),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
      resolveRefs(w.ctx, { actor: WIKI, refs: ['tasks:task:42'], invoker: w.apps }),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(resolveRefs(w.ctx, { actor: helper, refs: [], invoker: w.apps })).rejects.toThrow(
      ValidationError,
    );
  });

  it('Personen-Verweise zeigen nur, was im Verweis steht, und fragen keine App', async () => {
    const result = await resolveAs(anna, ['human:ben@example.com', 'agent:helper']);
    expect(result.results).toEqual([
      { ref: 'human:ben@example.com', state: 'resolved', kind: 'human', title: 'ben@example.com' },
      { ref: 'agent:helper', state: 'resolved', kind: 'agent', title: 'helper' },
    ]);
    expect(w.apps.calls).toEqual([]);
  });

  it('jeder Aufruf steht im Audit-Log, ohne die Verweise selbst', async () => {
    await resolveAs(ben, ['tasks:task:42']);
    expect(w.harness.store.auditEntries.at(-1)).toMatchObject({
      action: 'resolve_refs',
      outcome: 'allowed',
      detail: { restricted: 1, resolved: 0 },
    });
    expect(JSON.stringify(w.harness.store.auditEntries.at(-1))).not.toContain('task:42');
  });
});

/* -------------------------------------------------------------------------- */

describe('set_refs: nur eigene Objekte, nur mit Freigabe', () => {
  let w: World;
  beforeEach(async () => {
    w = await world();
  });

  const report = (actor: Actor, args: Record<string, unknown>) => setRefs(w.ctx, { actor, args });
  const page = (targets: unknown[], updatedAt = new Date(START - 60_000).toISOString()) => ({
    source: 'wiki:page:p1',
    targets,
    updatedAt,
    title: 'Meeting notes',
    path: '/pages/p1',
    actor: 'user:u-anna',
  });

  it('ohne Freigabe 403 mit Audit, nichts gespeichert', async () => {
    await expect(report(WIKI, page(['tasks:task:42']))).rejects.toThrow(PermissionDeniedError);
    expect(w.harness.store.refs.sources.size).toBe(0);
    expect(w.harness.store.auditEntries.at(-1)).toMatchObject({
      action: 'set_refs',
      outcome: 'denied',
      resource: { kind: 'tool', id: 'platform.set_refs' },
    });
  });

  it('lokal erteilt grantSelfRequests die beantragte Freigabe der App fuer sich selbst', async () => {
    const outcomes = await grantSelfRequests(w.ctx, admin, [wikiManifest()], () => undefined);
    expect(outcomes).toEqual([
      { label: 'app:wiki execute tool:platform.set_refs', outcome: 'granted' },
    ]);
    expect(await report(WIKI, page(['tasks:task:42']))).toMatchObject({ status: 'applied' });
  });

  it('weist ein fremdes Objekt ab (403), auch mit Freigabe', async () => {
    await grantTool(w.ctx, WIKI, 'platform.set_refs');
    await expect(
      report(WIKI, { ...page(['wiki:page:p1']), source: 'tasks:task:42' }),
    ).rejects.toThrow(PermissionDeniedError);
    expect(w.harness.store.refs.sources.size).toBe(0);
  });

  it('weist eine nicht erklaerte Objektart und falsche Formen ab (400)', async () => {
    await grantTool(w.ctx, WIKI, 'platform.set_refs');
    for (const bad of [
      { ...page([]), source: 'wiki:comment:1' },
      page(['not a ref']),
      { ...page([]), body: 'all the content' },
      page([], new Date(START + 3_600_000).toISOString()),
    ]) {
      await expect(report(WIKI, bad)).rejects.toThrow(ValidationError);
    }
  });

  it('nimmt von Menschen und Agents nichts an, auch mit Freigabe', async () => {
    await grantTool(w.ctx, helper, 'platform.set_refs');
    await expect(report(helper, page([]))).rejects.toThrow(PermissionDeniedError);
  });

  it('aelterer Stand ueberschreibt nichts, leere Menge loescht und behaelt den Stand', async () => {
    await grantTool(w.ctx, WIKI, 'platform.set_refs');
    const t1 = new Date(START - 30_000).toISOString();
    const t0 = new Date(START - 60_000).toISOString();
    expect(await report(WIKI, page(['tasks:task:42'], t1))).toMatchObject({ status: 'applied' });
    expect(await report(WIKI, page(['tasks:project:p1'], t0))).toMatchObject({ status: 'stale' });
    expect(await w.harness.store.refs.listOutgoing('wiki:page:p1')).toEqual([
      { ref: 'tasks:task:42', kind: 'link', targetApp: 'tasks' },
    ]);
    expect(await report(WIKI, page([], t1))).toMatchObject({ status: 'applied', targets: 0 });
    expect(await w.harness.store.refs.listOutgoing('wiki:page:p1')).toEqual([]);
    // Nach dem Loeschen bringt eine verspaetete aeltere Meldung nichts zurueck.
    expect(await report(WIKI, page(['tasks:task:42'], t0))).toMatchObject({ status: 'stale' });
    expect(await w.harness.store.refs.listOutgoing('wiki:page:p1')).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */

describe('Rueckverweise: nur, wenn beide Apps lesbar sind', () => {
  let w: World;
  beforeEach(async () => {
    w = await world();
    await grantTool(w.ctx, WIKI, 'platform.set_refs');
    await setRefs(w.ctx, {
      actor: WIKI,
      args: {
        source: 'wiki:page:p1',
        targets: ['tasks:task:42'],
        updatedAt: new Date(START - 1000).toISOString(),
      },
    });
  });

  it('Wiki-Seite verweist auf Aufgabe, die Aufgabe zeigt den Rueckverweis', async () => {
    await grantRead(w.ctx, asUser(anna), 'tasks');
    await grantRead(w.ctx, asUser(anna), 'wiki');
    expect(await listBacklinks(w.ctx, { actor: asUser(anna), ref: 'tasks:task:42' })).toEqual({
      ref: 'tasks:task:42',
      backlinks: [
        {
          source: 'wiki:page:p1',
          kind: 'link',
          app: 'wiki',
          appTitle: 'wiki',
          updatedAt: new Date(START - 1000).toISOString(),
        },
      ],
    });
  });

  it('wer das Wiki nicht lesen darf, sieht ihn nicht; wer Tasks nicht lesen darf, nichts', async () => {
    await grantRead(w.ctx, asUser(ben), 'tasks');
    expect(
      (await listBacklinks(w.ctx, { actor: asUser(ben), ref: 'tasks:task:42' })).backlinks,
    ).toEqual([]);
    await grantRead(w.ctx, asUser(cleo), 'wiki');
    expect(
      (await listBacklinks(w.ctx, { actor: asUser(cleo), ref: 'tasks:task:42' })).backlinks,
    ).toEqual([]);
  });

  it('weist Subjekte als Ziel ab und laesst Apps nicht fragen', async () => {
    await expect(
      listBacklinks(w.ctx, { actor: asUser(anna), ref: 'human:anna@example.com' }),
    ).rejects.toThrow(ValidationError);
    await expect(listBacklinks(w.ctx, { actor: TASKS, ref: 'tasks:task:42' })).rejects.toThrow(
      PermissionDeniedError,
    );
  });
});

/* -------------------------------------------------------------------------- */

describe('Erwaehnungen: nur mit read auf der Quell-App, nur neu hinzugekommene', () => {
  let w: World;
  beforeEach(async () => {
    w = await world();
    await grantTool(w.ctx, WIKI, 'platform.set_refs');
  });

  const mention = (targets: string[], at: number) =>
    setRefs(w.ctx, {
      actor: WIKI,
      args: {
        source: 'wiki:page:p1',
        targets,
        updatedAt: new Date(at).toISOString(),
        title: 'Meeting notes',
        path: '/pages/p1',
        actor: 'user:u-anna',
      },
    });

  const inboxOf = (user: { id: string; email: string }) =>
    listInbox(w.ctx, { actor: asUser(user), email: user.email });

  it('erwaehnte Person mit read bekommt platform.mentioned, ohne read nicht', async () => {
    await grantRead(w.ctx, asUser(ben), 'wiki');
    const outcome = await mention(
      ['human:ben@example.com', 'human:cleo@example.com'],
      START - 5000,
    );
    expect(outcome.mentioned).toBe(2);
    const ownerIds = w.harness.store.events.storedNotifications.map((n) => n.owner.id);
    expect(ownerIds).toEqual(['ben@example.com']);
    expect((await inboxOf(ben)).items[0]).toMatchObject({
      app: 'wiki',
      type: 'platform.mentioned',
      title: 'Mentioned in Meeting notes',
      object: 'wiki:page:p1',
      href: 'https://apps.example.com/wiki/pages/p1',
      importance: 'high',
    });
    expect((await inboxOf(cleo)).items).toEqual([]);
  });

  it('erneutes set_refs mit derselben Menge erzeugt nichts, ein neues Subjekt schon', async () => {
    await grantRead(w.ctx, asUser(ben), 'wiki');
    await grantRead(w.ctx, asUser(cleo), 'wiki');
    await mention(['human:ben@example.com'], START - 5000);
    expect((await mention(['human:ben@example.com'], START - 4000)).mentioned).toBe(0);
    expect(w.harness.store.events.storedEvents).toHaveLength(1);
    await mention(['human:ben@example.com', 'human:cleo@example.com'], START - 3000);
    expect(w.harness.store.events.storedEvents).toHaveLength(2);
    expect(w.harness.store.events.storedNotifications.map((n) => n.owner.id)).toEqual([
      'ben@example.com',
      'cleo@example.com',
    ]);
  });

  it('der Ausloeser bekommt nichts, eine Gruppe wird zu ihren Mitgliedern, ein Agent mit read auch', async () => {
    await grantRead(w.ctx, { kind: 'group', id: 'team' }, 'wiki');
    await createGroup(w.ctx, { actor: admin, name: 'team' });
    await addGroupMember(w.ctx, { actor: admin, group: 'team', email: anna.email });
    await addGroupMember(w.ctx, { actor: admin, group: 'team', email: ben.email });
    await createAgentIdentity(w.ctx, { actor: admin, name: 'helper', displayName: 'Helper' });
    await grantRead(w.ctx, helper, 'wiki');
    await mention(['group:team', 'agent:helper'], START - 5000);
    expect(
      w.harness.store.events.storedNotifications.map((n) => `${n.owner.kind}:${n.owner.id}`).sort(),
    ).toEqual(['agent:helper', 'human:ben@example.com']);
  });

  it('ein App kann platform.mentioned nicht selbst melden', async () => {
    const { emitEvent } = await import('../src/domain');
    await grantTool(w.ctx, WIKI, 'platform.emit_event');
    await expect(
      emitEvent(w.ctx, {
        actor: WIKI,
        args: {
          id: 'fake-mention',
          type: 'platform.mentioned',
          object: 'wiki:page:p1',
          title: 'Mentioned',
          path: '/pages/p1',
          audience: ['human:ben@example.com'],
        },
      }),
    ).rejects.toThrow(ValidationError);
  });
});

/* -------------------------------------------------------------------------- */

describe('list_people: nur Subjekte mit read auf dieselbe App', () => {
  let w: World;
  beforeEach(async () => {
    w = await world();
    await grantRead(w.ctx, asUser(anna), 'wiki');
    await grantRead(w.ctx, { kind: 'group', id: 'team' }, 'wiki');
    await createGroup(w.ctx, { actor: admin, name: 'team' });
    await addGroupMember(w.ctx, { actor: admin, group: 'team', email: 'dora@example.com' });
    await grantRead(w.ctx, asUser(ben), 'tasks');
    await createAgentIdentity(w.ctx, { actor: admin, name: 'helper', displayName: 'Helper' });
    await createAgentIdentity(w.ctx, { actor: admin, name: 'retired', displayName: 'Retired' });
    await grantRead(w.ctx, helper, 'wiki');
    await grantRead(w.ctx, { kind: 'agent', id: 'retired' }, 'wiki');
    await disableAgentIdentity(w.ctx, { actor: admin, name: 'retired' });
  });

  it('zeigt Menschen und aktive Agents mit read auf die App, sonst niemanden', async () => {
    const result = await listPeople(w.ctx, { actor: asUser(anna), app: 'wiki' });
    expect(result.people.map((p) => p.ref)).toEqual([
      'human:anna@example.com',
      'human:dora@example.com',
      'agent:helper',
    ]);
    expect(result.people.map((p) => p.ref)).not.toContain('human:ben@example.com');
  });

  it('filtert nach Text und liefert nichts an jemanden ohne read', async () => {
    expect(
      (await listPeople(w.ctx, { actor: asUser(anna), app: 'wiki', q: 'DOR' })).people.map(
        (p) => p.ref,
      ),
    ).toEqual(['human:dora@example.com']);
    expect((await listPeople(w.ctx, { actor: asUser(ben), app: 'wiki' })).people).toEqual([]);
    expect((await listPeople(w.ctx, { actor: asUser(ben), app: 'nope' })).people).toEqual([]);
  });

  it('ein Widerruf nimmt die Person beim naechsten Aufruf heraus', async () => {
    const grants = await w.ctx.grants.listForResource({ kind: 'app', id: 'wiki' });
    const groupGrant = grants.find((g) => g.subject.kind === 'group' && g.subject.id === 'team');
    await revoke(w.ctx, { actor: admin, grantId: groupGrant?.id ?? '' });
    expect(
      (await listPeople(w.ctx, { actor: asUser(anna), app: 'wiki' })).people.map((p) => p.ref),
    ).not.toContain('human:dora@example.com');
  });
});

/* -------------------------------------------------------------------------- */

describe('list_actions: aus X wird Y', () => {
  let w: World;
  beforeEach(async () => {
    w = await world();
  });

  it('eine Person mit read auf Quelle und Ziel-App bekommt die Adresse in der Ziel-App', async () => {
    await grantRead(w.ctx, asUser(anna), 'wiki');
    await grantRead(w.ctx, asUser(anna), 'tasks');
    const result = await listActions(w.ctx, {
      actor: asUser(anna),
      ref: 'wiki:page:p1',
      excerpt: 'Ship it\nby Friday',
    });
    expect(result.actions).toEqual([
      {
        app: 'tasks',
        appTitle: 'tasks',
        name: 'task_from_ref',
        title: 'Create task',
        tool: 'tasks.tasks.create_from_ref',
        href: 'https://apps.example.com/tasks/new?ref=wiki%3Apage%3Ap1&excerpt=Ship+it%0Aby+Friday',
      },
    ]);
  });

  it('ohne read auf die Ziel-App oder die Quelle keine Aktion', async () => {
    await grantRead(w.ctx, asUser(ben), 'wiki');
    expect((await listActions(w.ctx, { actor: asUser(ben), ref: 'wiki:page:p1' })).actions).toEqual(
      [],
    );
    await grantRead(w.ctx, asUser(cleo), 'tasks');
    expect(
      (await listActions(w.ctx, { actor: asUser(cleo), ref: 'wiki:page:p1' })).actions,
    ).toEqual([]);
  });

  it('ein Agent sieht die Aktion nur mit execute auf das Tool, ohne Adresse', async () => {
    expect((await listActions(w.ctx, { actor: helper, ref: 'wiki:page:p1' })).actions).toEqual([]);
    await grantTool(w.ctx, helper, 'tasks.tasks.create_from_ref');
    expect((await listActions(w.ctx, { actor: helper, ref: 'wiki:page:p1' })).actions).toEqual([
      {
        app: 'tasks',
        appTitle: 'tasks',
        name: 'task_from_ref',
        title: 'Create task',
        tool: 'tasks.tasks.create_from_ref',
      },
    ]);
  });

  it('nicht angenommene Arten haben keine Aktion', async () => {
    await grantTool(w.ctx, helper, 'tasks.tasks.create_from_ref');
    expect((await listActions(w.ctx, { actor: helper, ref: 'tasks:task:42' })).actions).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */

describe('Suche: Treffer tragen einen Verweis', () => {
  it('setzt ref nur fuer Objektarten aus dem Manifest', async () => {
    const w = await world();
    const app = (await w.ctx.apps.findByName('tasks'))!;
    const outcome = await federateSearch({
      targets: [{ app, tool: 'search', baseHref: 'https://apps.example.com/tasks' }],
      query: 'offer',
      limit: 5,
      timeoutMs: 1000,
      call: async () => ({
        hits: [
          { id: '42', title: 'Write the offer', url: '/task/42', kind: 'task' },
          { id: 'c1', title: 'A comment', url: '/task/42', kind: 'comment' },
        ],
      }),
    });
    expect(outcome.results[0]?.hits.map((hit) => hit.ref ?? null)).toEqual(['tasks:task:42', null]);
  });
});
