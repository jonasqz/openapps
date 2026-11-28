/**
 * Die HTTP-Wege der Verweise (ADR 0023 F).
 *
 * - `POST /api/apps/platform/tools/set_refs`: dieselbe Signaturpruefung wie
 *   fuer App-Aufrufe (ADR 0020). Gefaelscht oder fremd signiert 401 mit
 *   Audit, ohne Freigabe 403, fremdes Objekt 403.
 * - `/_platform/refs/…` und `/_platform/people` auf dem Host der Apps: genau
 *   diese Pfade, ohne Session 401, und die Route glaubt nur der Session,
 *   keinem `X-Auth-*` aus dem Browser.
 * - Der lokale Ansehen-Proxy loest als der Betrachter auf.
 */

import {
  appCallSignatureFor,
  CALLER_HEADER,
  CALLER_ISSUED_AT_HEADER,
  CALLER_SIGNATURE_HEADER,
  sha256Hex,
} from '@openapps/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appCallSecret,
  createApp,
  grant,
  PLATFORM_PATHS,
  type AppManifest,
  type AppToolInvoker,
} from '../src/domain';
import { GET as forwardAuth } from '../src/app/api/authz/forward/route';
import { ansichtRefs } from '../src/infra/lokal-ansehen';
import { resetSessionReader, setSessionReader } from '../src/lib/actor';
import { handleAppCall } from '../src/lib/app-call';
import {
  handleActions,
  handleBacklinks,
  handlePeople,
  handleResolveRefs,
  refsFromQuery,
} from '../src/lib/refs-http';
import { setDomainContext } from '../src/lib/runtime';
import { createBetterAuthSessionReader, denyAllSessions } from '../src/lib/session';
import {
  admin,
  createHarness,
  manifest,
  seedBootstrapGrants,
  TEST_MASTER_SECRET,
  type Harness,
} from './helpers';

const CONTROL_PLANE_HOST = 'control-plane.example.com';
const APPS_DOMAIN = 'apps.example.com';
const COOKIE = 'better-auth.session_token=abc';

const ENV: Record<string, string> = {
  DATABASE_URL: 'postgres://unused@localhost:1/none',
  APP_DATABASE_HOST: 'localhost:1/none',
  APPS_DOMAIN,
  CONTROL_PLANE_HOST,
  CONTROL_PLANE_SERVICE_URL: 'http://openapps-control-plane:3000',
  OPENAPPS_AUTH_MASTER_SECRET: 'master-secret-nur-fuer-tests-0123456789',
};

const ben = { id: 'u-ben', email: 'ben@example.com', name: 'Ben' };

const FORGED = {
  'x-auth-user-id': 'u-admin',
  'x-auth-user-email': 'admin@example.com',
  'x-auth-groups': 'platform-admins',
  'x-auth-issued-at': String(Math.floor(Date.now() / 1000)),
  'x-auth-signature': 'f'.repeat(64),
};

function tasksManifest(): AppManifest {
  const base = manifest('tasks');
  return {
    ...base,
    offeredTools: [
      ...base.offeredTools,
      { name: 'resolve', description: 'Resolve.', verb: 'read', operationId: 'resolve' },
      { name: 'tasks.create_from_ref', description: 'Create.', verb: 'write', operationId: 'c' },
    ],
    objects: [{ type: 'task', description: 'A task.', resolver: 'resolve' }],
    actions: [
      {
        name: 'task_from_ref',
        title: 'Create task',
        accepts: ['wiki:page'],
        tool: 'tasks.create_from_ref',
        path: '/new',
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
      { name: 'pages.resolve', description: 'Resolve.', verb: 'read', operationId: 'r' },
    ],
    objects: [{ type: 'page', description: 'A page.', resolver: 'pages.resolve' }],
  };
}

function signIn(user: { id: string; email: string }): void {
  setSessionReader(
    createBetterAuthSessionReader({
      auth: {
        api: {
          getSession(context: { headers: Headers }) {
            return Promise.resolve(context.headers.get('cookie') === null ? null : { user });
          },
        },
      },
      groups: { groupsFor: () => Promise.resolve([]) },
    }),
  );
}

const titles: AppToolInvoker & { seen: string[] } = {
  seen: [],
  async invoke({ app, args, humanIdentity }) {
    titles.seen.push(`${app.name}:${humanIdentity?.email ?? '-'}`);
    return {
      objects: ((args.ids as string[]) ?? []).map((id) => ({
        id,
        title: `${app.name} ${id}`,
        path: `/x/${id}`,
        updatedAt: '2026-01-01T00:00:00.000Z',
      })),
    };
  },
};

describe('set_refs ueber den signierten Weg', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = createHarness({ appsDomain: APPS_DOMAIN });
    await seedBootstrapGrants(harness);
    await createApp(harness.ctx, { actor: admin, name: 'tasks', manifest: tasksManifest() });
    await createApp(harness.ctx, { actor: admin, name: 'wiki', manifest: wikiManifest() });
  });

  function signed(options: {
    caller?: string;
    secretOf?: string;
    body?: Record<string, unknown>;
    signature?: string;
  }): Request {
    const caller = options.caller ?? 'wiki';
    const body = JSON.stringify(
      options.body ?? {
        source: 'wiki:page:p1',
        targets: ['tasks:task:42'],
        updatedAt: new Date(Date.now() - 60_000).toISOString(),
      },
    );
    const issuedAt = String(Math.floor(harness.ctx.clock.now().getTime() / 1000));
    const signature =
      options.signature ??
      appCallSignatureFor({
        secret: appCallSecret({
          masterSecret: TEST_MASTER_SECRET,
          appId: options.secretOf ?? caller,
          generation: 1,
        }),
        caller,
        app: 'platform',
        tool: 'set_refs',
        issuedAt,
        bodySha256: sha256Hex(body),
      });
    return new Request('http://openapps-control-plane:3000/api/apps/platform/tools/set_refs', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [CALLER_HEADER]: caller,
        [CALLER_ISSUED_AT_HEADER]: issuedAt,
        [CALLER_SIGNATURE_HEADER]: signature,
      },
      body,
    });
  }

  const call = (request: Request) =>
    handleAppCall(harness.ctx, titles, request, { app: 'platform', tool: 'set_refs' });

  const grantSetRefs = (app: string) =>
    grant(harness.ctx, {
      actor: admin,
      subject: { kind: 'app', id: app },
      verb: 'execute',
      resource: { kind: 'tool', id: 'platform.set_refs' },
    });

  it('glaubt keiner fremden oder erfundenen Signatur (401, Audit), auch mit X-Auth-Headern', async () => {
    await grantSetRefs('wiki');
    const foreign = await call(signed({ secretOf: 'tasks' }));
    expect(foreign.status).toBe(401);
    expect(harness.store.auditEntries.at(-1)).toMatchObject({
      actor: { kind: 'app', id: 'wiki' },
      outcome: 'denied',
      resource: { kind: 'tool', id: 'platform.set_refs' },
    });
    const forged = signed({ signature: 'a'.repeat(64) });
    for (const [key, value] of Object.entries(FORGED)) forged.headers.set(key, value);
    expect((await call(forged)).status).toBe(401);
    expect(harness.store.refs.sources.size).toBe(0);
  });

  it('ohne Freigabe 403, mit Freigabe angenommen, fremdes Objekt 403, falsche Form 400', async () => {
    expect((await call(signed({}))).status).toBe(403);
    await grantSetRefs('wiki');
    const ok = await call(signed({}));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ status: 'applied', targets: 1 });

    await grantSetRefs('tasks');
    const foreign = await call(
      signed({
        caller: 'tasks',
        body: { source: 'wiki:page:p1', targets: [], updatedAt: new Date().toISOString() },
      }),
    );
    expect(foreign.status).toBe(403);
    expect((await call(signed({ body: { source: 'wiki:page:p1' } }))).status).toBe(400);
  });

  it('der Aufrufer kann set_refs nur fuer sich freigeben lassen, wer app:* hat', async () => {
    await expect(
      grant(harness.ctx, {
        actor: { kind: 'user', id: 'u-nobody', groups: [] },
        subject: { kind: 'app', id: 'wiki' },
        verb: 'execute',
        resource: { kind: 'tool', id: 'platform.set_refs' },
      }),
    ).rejects.toThrow();
  });
});

describe('Pfade der Verweise auf dem Host der Apps', () => {
  let harness: Harness;
  const previousEnv = new Map<string, string | undefined>();

  beforeEach(async () => {
    for (const [key, value] of Object.entries(ENV)) {
      previousEnv.set(key, process.env[key]);
      process.env[key] = value;
    }
    harness = createHarness({ appsDomain: APPS_DOMAIN });
    await seedBootstrapGrants(harness);
    await createApp(harness.ctx, { actor: admin, name: 'tasks', manifest: tasksManifest() });
    await createApp(harness.ctx, { actor: admin, name: 'wiki', manifest: wikiManifest() });
    setDomainContext(harness.ctx);
    setSessionReader(denyAllSessions);
    titles.seen.length = 0;
  });

  afterEach(() => {
    setDomainContext(undefined);
    resetSessionReader();
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const forward = (path: string, cookie?: string) => {
    const headers = new Headers({
      'x-forwarded-host': APPS_DOMAIN,
      'x-forwarded-uri': path,
      'x-forwarded-method': 'GET',
    });
    if (cookie !== undefined) headers.set('cookie', cookie);
    return forwardAuth(new Request(`https://${CONTROL_PLANE_HOST}/api/authz/forward`, { headers }));
  };

  it('laesst genau die vier neuen Pfade durch, ohne Session 401, mit Session ohne Header', async () => {
    for (const path of [
      '/_platform/refs/resolve',
      '/_platform/refs/backlinks',
      '/_platform/refs/actions',
      '/_platform/people',
    ]) {
      expect(PLATFORM_PATHS).toContain(path);
      expect((await forward(`${path}?ref=tasks:task:1`)).status, path).toBe(401);
    }
    signIn(ben);
    const ok = await forward('/_platform/refs/resolve?ref=tasks:task:1', COOKIE);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('x-auth-user-id')).toBeNull();
    for (const path of [
      '/_platform/refs',
      '/_platform/refs/resolve/x',
      '/_platform/refs/../search',
      '/_platform/refs/%2e%2e/search',
      '/_platform/people/',
    ]) {
      expect((await forward(path, COOKIE)).status, path).toBe(403);
    }
  });

  it('die Route glaubt nur der Session: gefaelschte X-Auth-Header oeffnen nichts', async () => {
    const request = new Request(`https://${APPS_DOMAIN}/_platform/refs/resolve?ref=tasks:task:42`, {
      headers: { ...FORGED },
    });
    expect((await handleResolveRefs(harness.ctx, titles, request)).status).toBe(403);

    signIn(ben);
    const withSession = new Request(
      `https://${APPS_DOMAIN}/_platform/refs/resolve?ref=tasks:task:42`,
      { headers: { ...FORGED, cookie: COOKIE } },
    );
    const response = await handleResolveRefs(harness.ctx, titles, withSession);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      results: [{ ref: 'tasks:task:42', state: 'restricted' }],
    });
    expect(titles.seen).toEqual([]);

    await grant(harness.ctx, {
      actor: admin,
      subject: { kind: 'user', id: ben.id },
      verb: 'read',
      resource: { kind: 'app', id: 'tasks' },
    });
    const allowed = await handleResolveRefs(harness.ctx, titles, withSession);
    expect(await allowed.json()).toMatchObject({
      results: [{ ref: 'tasks:task:42', state: 'resolved', title: 'tasks 42' }],
    });
    expect(titles.seen).toEqual(['tasks:ben@example.com']);
  });

  it('Rueckverweise, Aktionen und Personen brauchen eine Session', async () => {
    const url = `https://${APPS_DOMAIN}/_platform/refs/backlinks?ref=tasks:task:42`;
    expect((await handleBacklinks(harness.ctx, new Request(url))).status).toBe(403);
    expect(
      (await handleActions(harness.ctx, new Request(url.replace('backlinks', 'actions')))).status,
    ).toBe(403);
    expect(
      (
        await handlePeople(
          harness.ctx,
          new Request(`https://${APPS_DOMAIN}/_platform/people?app=wiki`),
        )
      ).status,
    ).toBe(403);
    signIn(ben);
    const people = await handlePeople(
      harness.ctx,
      new Request(`https://${APPS_DOMAIN}/_platform/people?app=wiki&q=a`, {
        headers: { cookie: COOKIE },
      }),
    );
    expect(await people.json()).toEqual({ app: 'wiki', people: [] });
  });

  it('liest Verweise aus ref und refs', () => {
    expect(
      refsFromQuery(new URLSearchParams('ref=tasks:task:1&ref=wiki:page:2&refs=crm:deal:3,%20x')),
    ).toEqual(['tasks:task:1', 'wiki:page:2', 'crm:deal:3', 'x']);
  });
});

describe('lokaler Ansehen-Proxy', () => {
  it('loest als der Betrachter auf und verlinkt Aktionen auf den Proxy', async () => {
    const harness = createHarness({ appsDomain: APPS_DOMAIN });
    await seedBootstrapGrants(harness);
    await createApp(harness.ctx, { actor: admin, name: 'tasks', manifest: tasksManifest() });
    await createApp(harness.ctx, { actor: admin, name: 'wiki', manifest: wikiManifest() });
    const apps = await harness.ctx.apps.listAll();
    titles.seen.length = 0;

    const resolved = (await ansichtRefs({
      path: '/_platform/refs/resolve',
      apps,
      url: new URL('http://x/_platform/refs/resolve?ref=tasks:task:7&ref=mail:message:1'),
      invoker: titles,
    })) as { results: unknown[] };
    expect(resolved.results).toEqual([
      expect.objectContaining({
        state: 'resolved',
        title: 'tasks 7',
        href: 'http://127.0.0.1:8090/tasks/x/7',
      }),
      { ref: 'mail:message:1', state: 'restricted' },
    ]);
    expect(titles.seen).toEqual(['tasks:viewer@local.test']);

    const actions = (await ansichtRefs({
      path: '/_platform/refs/actions',
      apps,
      url: new URL('http://x/_platform/refs/actions?ref=wiki:page:p1&excerpt=Hello'),
      invoker: titles,
    })) as { actions: { href: string }[] };
    expect(actions.actions.map((a) => a.href)).toEqual([
      'http://127.0.0.1:8090/tasks/new?ref=wiki%3Apage%3Ap1&excerpt=Hello',
    ]);
  });
});
