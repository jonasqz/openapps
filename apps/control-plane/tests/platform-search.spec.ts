/**
 * Die Suche ueber alle Apps (ADR 0021). Zuerst, was fehlen muss: Treffer aus
 * Apps ohne `read`, Treffer fuer einen Agenten ohne Freigabe auf das
 * Such-Tool, eine Suche als App. Dann, dass eine langsame oder kaputte App
 * die Suche nicht mitnimmt.
 */

import { getUser } from '@openapps/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appAuthSecret,
  createApp,
  grant,
  invocationIdentityFor,
  isSearchable,
  PermissionDeniedError,
  revoke,
  searchApps,
  ValidationError,
  type Actor,
  type AppManifest,
  type AppToolInvoker,
  type HumanIdentity,
} from '../src/domain';
import { createHttpInvoker } from '../src/infra/app-tool-invoker';
import { admin, createHarness, manifest, seedBootstrapGrants, type Harness } from './helpers';

const APPS_DOMAIN = 'apps.example.com';

const lena: Actor = { kind: 'user', id: 'u-lena', groups: ['sales'] };
const lenaIdentity: HumanIdentity = {
  userId: 'u-lena',
  email: 'lena@example.com',
  groups: ['sales'],
};
const agent: Actor = { kind: 'agent', id: 'finder' };

function searchable(name: string, extra: Partial<AppManifest> = {}): AppManifest {
  const base = manifest(name);
  return {
    ...base,
    offeredTools: [
      ...base.offeredTools,
      { name: 'search', description: 'Sucht', verb: 'read', operationId: 'search' },
    ],
    search: { tool: 'search' },
    ...extra,
  };
}

interface Call {
  readonly app: string;
  readonly tool: string;
  readonly actor: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly humanIdentity: HumanIdentity | undefined;
  readonly readableApps: readonly string[] | null | undefined;
}

/** Antwortet je App mit dem, was `answers` sagt; merkt sich jeden Aufruf. */
function recordingInvoker(
  answers: Record<string, (signal: AbortSignal | undefined) => Promise<unknown>> = {},
): AppToolInvoker & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    async invoke({ app, toolName, actor, args, humanIdentity, readableApps, signal }) {
      calls.push({
        app: app.name,
        tool: toolName,
        actor: `${actor.kind}:${actor.id}`,
        args,
        humanIdentity,
        readableApps,
      });
      const answer = answers[app.name];
      if (answer !== undefined) return answer(signal);
      return {
        hits: [{ id: `${app.name}-1`, title: `Treffer in ${app.name}`, url: '/items/1' }],
      };
    },
  };
}

async function readGrant(actor: Actor, app: string): Promise<void> {
  await grant(harnessRef.ctx, {
    actor: admin,
    subject: { kind: actor.kind, id: actor.id },
    verb: 'read',
    resource: { kind: 'app', id: app },
  });
}

async function executeGrant(actor: Actor, tool: string): Promise<void> {
  await grant(harnessRef.ctx, {
    actor: admin,
    subject: { kind: actor.kind, id: actor.id },
    verb: 'execute',
    resource: { kind: 'tool', id: tool },
  });
}

let harnessRef: Harness;

async function setup(): Promise<Harness> {
  const harness = createHarness({ appsDomain: APPS_DOMAIN });
  harnessRef = harness;
  await seedBootstrapGrants(harness);
  for (const name of ['crm', 'tasks', 'wiki']) {
    await createApp(harness.ctx, { actor: admin, name, manifest: searchable(name) });
  }
  return harness;
}

function asLena(invoker: AppToolInvoker, extra: Partial<Parameters<typeof searchApps>[1]> = {}) {
  return searchApps(harnessRef.ctx, {
    actor: lena,
    humanIdentity: lenaIdentity,
    query: 'angebot',
    invoker,
    ...extra,
  });
}

describe('Default-Deny: wer was durchsuchen darf', () => {
  beforeEach(async () => {
    await setup();
  });

  it('fragt fuer einen Menschen ohne read keine einzige App und meldet auch keine', async () => {
    const invoker = recordingInvoker();
    const result = await asLena(invoker);
    expect(invoker.calls).toEqual([]);
    expect(result.results).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(result.searched).toEqual([]);
  });

  it('fragt fuer einen Menschen genau die Apps mit read, mit seiner Identitaet', async () => {
    await readGrant(lena, 'crm');
    const invoker = recordingInvoker();
    const result = await asLena(invoker);

    expect(invoker.calls.map((c) => c.app)).toEqual(['crm']);
    expect(invoker.calls[0]?.humanIdentity).toEqual(lenaIdentity);
    expect(invoker.calls[0]?.args).toEqual({ query: 'angebot', limit: 5 });
    expect(result.results).toEqual([
      {
        app: 'crm',
        title: 'crm',
        hits: [
          {
            id: 'crm-1',
            title: 'Treffer in crm',
            url: '/items/1',
            href: `https://${APPS_DOMAIN}/crm/items/1`,
          },
        ],
      },
    ]);
  });

  it('wirkt auch ueber eine Gruppe, und ein Widerruf beim naechsten Aufruf', async () => {
    const created = await grant(harnessRef.ctx, {
      actor: admin,
      subject: { kind: 'group', id: 'sales' },
      verb: 'read',
      resource: { kind: 'app', id: 'tasks' },
    });
    const first = recordingInvoker();
    await asLena(first);
    expect(first.calls.map((c) => c.app)).toEqual(['tasks']);

    await revoke(harnessRef.ctx, { actor: admin, grantId: created.id });
    const second = recordingInvoker();
    await asLena(second);
    expect(second.calls).toEqual([]);
  });

  it('fragt fuer einen Agenten nur mit read auf die App UND execute auf das Such-Tool', async () => {
    // Nur read: nicht gefragt.
    await readGrant(agent, 'crm');
    // Nur execute: nicht gefragt.
    await executeGrant(agent, 'tasks.search');
    // Beides: gefragt.
    await readGrant(agent, 'wiki');
    await executeGrant(agent, 'wiki.search');

    const invoker = recordingInvoker();
    const result = await searchApps(harnessRef.ctx, { actor: agent, query: 'angebot', invoker });
    expect(invoker.calls.map((c) => c.app)).toEqual(['wiki']);
    expect(invoker.calls[0]?.actor).toBe('agent:finder');
    expect(invoker.calls[0]?.humanIdentity).toBeUndefined();
    expect(result.results.map((r) => r.app)).toEqual(['wiki']);
  });

  it('laesst eine App nicht suchen, auch nicht mit Freigaben', async () => {
    const asApp: Actor = { kind: 'app', id: 'crm' };
    await readGrant(asApp, 'wiki');
    await executeGrant(asApp, 'wiki.search');
    const invoker = recordingInvoker();
    await expect(
      searchApps(harnessRef.ctx, { actor: asApp, query: 'angebot', invoker }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(invoker.calls).toEqual([]);
    const entry = harnessRef.store.auditEntries.at(-1);
    expect(entry?.action).toBe('search');
    expect(entry?.outcome).toBe('denied');
  });

  it('laesst einen Menschen nur mit seiner eigenen Identitaet suchen', async () => {
    await readGrant(lena, 'crm');
    const invoker = recordingInvoker();
    await expect(
      searchApps(harnessRef.ctx, { actor: lena, query: 'angebot', invoker }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(
      searchApps(harnessRef.ctx, {
        actor: lena,
        humanIdentity: { ...lenaIdentity, userId: 'u-admin' },
        query: 'angebot',
        invoker,
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(invoker.calls).toEqual([]);
  });

  it('fragt Apps ohne Such-Tool nicht, und keine archivierte oder nie deployte', async () => {
    await createApp(harnessRef.ctx, { actor: admin, name: 'notes', manifest: manifest('notes') });
    const invoker = recordingInvoker();
    // Der Administrator darf alles lesen.
    await searchApps(harnessRef.ctx, {
      actor: admin,
      humanIdentity: { userId: 'u-admin', email: 'admin@example.com', groups: ['platform-admins'] },
      query: 'angebot',
      invoker,
    });
    expect(invoker.calls.map((c) => c.app)).toEqual(['crm', 'tasks', 'wiki']);

    const crm = await harnessRef.store.apps.findByName('crm');
    expect(crm).not.toBeNull();
    if (crm === null) return;
    expect(isSearchable(crm)).toBe(true);
    expect(isSearchable({ ...crm, archivedAt: new Date() })).toBe(false);
    expect(isSearchable({ ...crm, primaryDomain: null })).toBe(false);
    // Ein Such-Tool, das schreibt oder fehlt, zaehlt nicht (altes Manifest im Register).
    expect(
      isSearchable({
        ...crm,
        manifest: { ...crm.manifest, search: { tool: 'crm.list' }, offeredTools: [] },
      }),
    ).toBe(false);
  });

  it('nimmt nur die Apps aus dem Filter, unbekannte fallen still weg', async () => {
    await readGrant(lena, 'crm');
    await readGrant(lena, 'tasks');
    const invoker = recordingInvoker();
    await asLena(invoker, { apps: ['tasks', 'gibt-es-nicht', 'wiki'] });
    expect(invoker.calls.map((c) => c.app)).toEqual(['tasks']);
  });

  it('gibt die lesbaren Apps nur an Apps, die sie anfordern, und nur die lesbaren', async () => {
    await createApp(harnessRef.ctx, {
      actor: admin,
      name: 'knowledge',
      manifest: searchable('knowledge', { gatewayContext: ['readableApps'] }),
    });
    await readGrant(lena, 'knowledge');
    await readGrant(lena, 'crm');
    const invoker = recordingInvoker();
    await asLena(invoker);
    const byApp = new Map(invoker.calls.map((c) => [c.app, c.readableApps]));
    expect(byApp.get('knowledge')).toEqual(['crm', 'knowledge']);
    expect(byApp.get('crm')).toBeNull();
  });
});

describe('Eine App bricht die Suche nicht', () => {
  beforeEach(async () => {
    await setup();
    for (const name of ['crm', 'tasks', 'wiki']) await readGrant(lena, name);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('meldet eine App nach der Frist als timeout und bricht ihren Aufruf ab', async () => {
    let aborted = false;
    const invoker = recordingInvoker({
      crm: (signal) =>
        new Promise(() => {
          signal?.addEventListener('abort', () => {
            aborted = true;
          });
        }),
    });
    const started = Date.now();
    const result = await asLena(invoker, { timeoutMs: 50 });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(result.failed).toEqual([{ app: 'crm', title: 'crm', reason: 'timeout' }]);
    expect(result.results.map((r) => r.app)).toEqual(['tasks', 'wiki']);
    expect(aborted).toBe(true);
  });

  it('meldet einen Fehler und eine unbrauchbare Antwort, die anderen kommen trotzdem', async () => {
    const invoker = recordingInvoker({
      crm: () => Promise.reject(new Error('app "crm" responded 500: boom')),
      tasks: () => Promise.resolve({ passages: [] }),
    });
    const result = await asLena(invoker);
    expect(result.failed).toEqual([
      { app: 'crm', title: 'crm', reason: 'error' },
      { app: 'tasks', title: 'tasks', reason: 'invalid_response' },
    ]);
    expect(result.results.map((r) => r.app)).toEqual(['wiki']);
    expect(result.searched).toEqual(['wiki']);
  });

  it('laesst Treffer mit einer Adresse ausserhalb der App weg', async () => {
    const invoker = recordingInvoker({
      crm: () =>
        Promise.resolve({
          hits: [
            { id: '1', title: 'Gut', url: '/deals/1' },
            { id: '2', title: 'Fremd', url: 'https://evil.example/' },
            { id: '3', title: 'Raus', url: '/../wiki/pages/1' },
          ],
        }),
    });
    const result = await asLena(invoker, { apps: ['crm'] });
    expect(result.results[0]?.hits.map((h) => h.href)).toEqual([
      `https://${APPS_DOMAIN}/crm/deals/1`,
    ]);
  });

  it('nimmt eine andere Adresse der App, wenn der Aufrufer sie vorgibt (lokal: Ansehen-Proxy)', async () => {
    const result = await asLena(recordingInvoker(), {
      apps: ['crm'],
      appHref: (app) => `http://127.0.0.1:8090/${app.name}`,
    });
    expect(result.results[0]?.hits[0]?.href).toBe('http://127.0.0.1:8090/crm/items/1');
  });

  it('kappt die Treffer je App beim Limit, auch wenn die App mehr liefert', async () => {
    const invoker = recordingInvoker({
      crm: () =>
        Promise.resolve({
          hits: Array.from({ length: 12 }, (_, i) => ({ id: String(i), title: 't', url: '/x' })),
        }),
    });
    const result = await asLena(invoker, { apps: ['crm'], limit: 3 });
    expect(invoker.calls[0]?.args).toEqual({ query: 'angebot', limit: 3 });
    expect(result.results[0]?.hits).toHaveLength(3);
  });
});

describe('Eingabe und Audit-Log', () => {
  beforeEach(async () => {
    await setup();
    await readGrant(lena, 'crm');
  });

  it('weist zu kurze, zu lange Suchtexte und falsche Grenzen ab, ohne eine App zu fragen', async () => {
    const invoker = recordingInvoker();
    for (const extra of [
      { query: 'a' },
      { query: '  a  ' },
      { query: 'x'.repeat(201) },
      { limit: 0 },
      { limit: 11 },
      { limit: Number.NaN },
    ]) {
      await expect(asLena(invoker, extra), JSON.stringify(extra)).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
    expect(invoker.calls).toEqual([]);
  });

  it('schreibt genau einen Eintrag je Suche, ohne den Suchtext', async () => {
    const before = harnessRef.store.auditEntries.length;
    await asLena(recordingInvoker(), { query: 'Geheimkunde GmbH' });
    const entries = harnessRef.store.auditEntries.slice(before);
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry?.action).toBe('search');
    expect(entry?.outcome).toBe('allowed');
    expect(entry?.actor).toEqual({ kind: 'user', id: 'u-lena' });
    expect(entry?.detail).toMatchObject({ queryLength: 16, searched: ['crm'], hits: 1 });
    expect(JSON.stringify(entry)).not.toContain('Geheimkunde');
  });
});

describe('invocationIdentityFor und der HTTP-Invoker', () => {
  it('signiert einen Menschen nur mit seiner eigenen Identitaet', () => {
    expect(invocationIdentityFor(lena, lenaIdentity, 100)).toEqual({
      ...lenaIdentity,
      issuedAt: 100,
    });
    expect(() => invocationIdentityFor(lena, { ...lenaIdentity, userId: 'u-admin' }, 1)).toThrow(
      PermissionDeniedError,
    );
    expect(() => invocationIdentityFor(agent, lenaIdentity, 1)).toThrow(PermissionDeniedError);
    expect(invocationIdentityFor(agent, undefined, 1).userId).toBe('agent:finder');
    expect(() => invocationIdentityFor(lena, undefined, 1)).toThrow(PermissionDeniedError);
  });

  it('schickt die Identitaet des Menschen so, dass die App sie mit ihrem Secret prueft', async () => {
    const harness = createHarness({ appsDomain: APPS_DOMAIN });
    await seedBootstrapGrants(harness);
    const app = await createApp(harness.ctx, {
      actor: admin,
      name: 'crm',
      manifest: searchable('crm'),
    });
    const now = 1_794_387_600_000;
    let seen: Headers | undefined;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      seen = new Headers(init.headers);
      return new Response(JSON.stringify({ hits: [] }), { status: 200 });
    });
    try {
      const invoker = createHttpInvoker({
        authMasterSecret: harness.ctx.authMasterSecret,
        now: () => now,
      });
      await invoker.invoke({
        app,
        toolName: 'search',
        actor: lena,
        args: { query: 'x', limit: 5 },
        humanIdentity: lenaIdentity,
      });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(seen).toBeDefined();
    const secret = appAuthSecret({
      masterSecret: harness.ctx.authMasterSecret,
      appId: 'crm',
      generation: app.authSecretGeneration,
    });
    const user = getUser(seen ?? new Headers(), {
      secret,
      appId: 'crm',
      appHost: APPS_DOMAIN,
      now: () => now,
    });
    expect(user).toMatchObject({ id: 'u-lena', email: 'lena@example.com', groups: ['sales'] });
    // Mit dem Secret einer anderen App passt die Signatur nicht.
    expect(() =>
      getUser(seen ?? new Headers(), {
        secret: 'x'.repeat(48),
        appId: 'crm',
        appHost: APPS_DOMAIN,
        now: () => now,
      }),
    ).toThrow();
  });
});
