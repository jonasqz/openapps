/**
 * Die HTTP-Wege zu Ereignissen und Eingang (ADR 0022).
 *
 * - `POST /api/apps/platform/tools/emit_event`: dieselbe Signaturpruefung wie
 *   fuer App-Aufrufe (ADR 0020). Eine gefaelschte oder fremde Signatur ist
 *   401 mit Audit, ohne Freigabe 403, ein nicht erklaerter Typ 400.
 * - `GET /api/inbox` und `/_platform/inbox`: nur die Session zaehlt,
 *   gefaelschte `X-Auth-*` aendern nichts.
 * - `POST /api/inbox/mark`: nur von der eigenen Herkunft.
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
  type AppManifest,
  type AppToolInvoker,
} from '../src/domain';
import { GET as forwardAuth } from '../src/app/api/authz/forward/route';
import { resetSessionReader, setSessionReader } from '../src/lib/actor';
import { handleAppCall } from '../src/lib/app-call';
import { handleInboxList, handleInboxMark, sameOriginWrite } from '../src/lib/inbox-http';
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

const noInvoker: AppToolInvoker = {
  async invoke() {
    throw new Error('no app is called for platform tools');
  },
};

function tasksManifest(): AppManifest {
  return {
    ...manifest('tasks'),
    events: [{ type: 'task.assigned', description: 'Assigned.', importance: 'high' }],
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

describe('emit_event ueber den signierten Weg', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = createHarness({ appsDomain: APPS_DOMAIN });
    await seedBootstrapGrants(harness);
    await createApp(harness.ctx, { actor: admin, name: 'tasks', manifest: tasksManifest() });
    await createApp(harness.ctx, { actor: admin, name: 'wiki', manifest: manifest('wiki') });
    harness.store.users.add(ben);
  });

  function signed(options: {
    caller?: string;
    secretOf?: string;
    tool?: string;
    body?: Record<string, unknown>;
    signature?: string;
  }): { request: Request; tool: string } {
    const caller = options.caller ?? 'tasks';
    const tool = options.tool ?? 'emit_event';
    const body = JSON.stringify(
      options.body ?? {
        id: 'task.assigned:1:1',
        type: 'task.assigned',
        object: 'task:1',
        title: 'Assigned to you: A',
        path: '/task/1',
        audience: ['human:ben@example.com'],
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
        tool,
        issuedAt,
        bodySha256: sha256Hex(body),
      });
    return {
      tool,
      request: new Request(`http://openapps-control-plane:3000/api/apps/platform/tools/${tool}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [CALLER_HEADER]: caller,
          [CALLER_ISSUED_AT_HEADER]: issuedAt,
          [CALLER_SIGNATURE_HEADER]: signature,
        },
        body,
      }),
    };
  }

  const call = ({ request, tool }: { request: Request; tool: string }) =>
    handleAppCall(harness.ctx, noInvoker, request, { app: 'platform', tool });

  const grantEmit = () =>
    grant(harness.ctx, {
      actor: admin,
      subject: { kind: 'app', id: 'tasks' },
      verb: 'execute',
      resource: { kind: 'tool', id: 'platform.emit_event' },
    });

  it('glaubt keinem Aufrufer, der mit dem Secret einer anderen App signiert (401, Audit)', async () => {
    await grantEmit();
    const response = await call(signed({ caller: 'tasks', secretOf: 'wiki' }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
    expect(harness.store.events.storedEvents).toHaveLength(0);
    expect(harness.store.auditEntries.at(-1)).toMatchObject({
      actor: { kind: 'app', id: 'tasks' },
      outcome: 'denied',
      resource: { kind: 'tool', id: 'platform.emit_event' },
    });
  });

  it('glaubt keiner erfundenen Signatur und keiner Identitaet aus X-Auth-Headern', async () => {
    await grantEmit();
    const forged = signed({ signature: 'a'.repeat(64) });
    for (const [key, value] of Object.entries(FORGED)) forged.request.headers.set(key, value);
    expect((await call(forged)).status).toBe(401);
  });

  it('ohne Freigabe 403, mit Freigabe angenommen, Doppel duplicate', async () => {
    expect((await call(signed({}))).status).toBe(403);
    await grantEmit();
    const first = await call(signed({}));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ status: 'accepted' });
    expect(await (await call(signed({}))).json()).toEqual({ status: 'duplicate' });
  });

  it('ein nicht erklaerter Typ ist 400, ein unbekanntes Plattform-Tool 404', async () => {
    await grantEmit();
    const undeclared = await call(
      signed({
        body: { id: 'x', type: 'task.deleted', object: 'task:1', title: 'T', path: '/task/1' },
      }),
    );
    expect(undeclared.status).toBe(400);
    expect(((await undeclared.json()) as { error: string }).error).toBe('invalid');
    expect((await call(signed({ tool: 'list_inbox' }))).status).toBe(404);
  });
});

describe('Eingang ueber HTTP', () => {
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
    harness.store.users.add(ben);
    setDomainContext(harness.ctx);
    setSessionReader(denyAllSessions);
  });

  afterEach(() => {
    setDomainContext(undefined);
    resetSessionReader();
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('ohne Session 403, auch mit gefaelschten Identitaets-Headern', async () => {
    const response = await handleInboxList(
      harness.ctx,
      new Request(`https://${CONTROL_PLANE_HOST}/api/inbox`, { headers: FORGED }),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('zeigt den Eingang der Session, nicht den aus gefaelschten Headern', async () => {
    signIn(ben);
    const response = await handleInboxList(
      harness.ctx,
      new Request(`https://${CONTROL_PLANE_HOST}/api/inbox?state=all`, {
        headers: { cookie: COOKIE, ...FORGED },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [], unread: 0, apps: [] });
    expect(harness.store.auditEntries.at(-1)).toMatchObject({
      action: 'list_inbox',
      actor: { kind: 'user', id: 'u-ben' },
    });
  });

  it('nimmt mark nur von der eigenen Herkunft an', async () => {
    signIn(ben);
    const body = JSON.stringify({ ids: ['00000000-0000-4000-8000-000000000001'], state: 'read' });
    const foreign = await handleInboxMark(
      harness.ctx,
      new Request(`https://${CONTROL_PLANE_HOST}/api/inbox/mark`, {
        method: 'POST',
        headers: { cookie: COOKIE, origin: `https://${APPS_DOMAIN}` },
        body,
      }),
      { controlPlaneHost: CONTROL_PLANE_HOST },
    );
    expect(foreign.status).toBe(403);

    const own = await handleInboxMark(
      harness.ctx,
      new Request(`https://${CONTROL_PLANE_HOST}/api/inbox/mark`, {
        method: 'POST',
        headers: { cookie: COOKIE, origin: `https://${CONTROL_PLANE_HOST}` },
        body,
      }),
      { controlPlaneHost: CONTROL_PLANE_HOST },
    );
    expect(own.status).toBe(200);
    expect(await own.json()).toEqual({ updated: 0 });
    expect(sameOriginWrite(new Request('http://x/', { headers: { origin: 'null' } }), 'x')).toBe(
      false,
    );
  });

  it('laesst /_platform/inbox auf dem Host der Apps nur mit Session durch, mark nie', async () => {
    const forward = (path: string, cookie?: string) => {
      const headers = new Headers({
        'x-forwarded-host': APPS_DOMAIN,
        'x-forwarded-uri': path,
        'x-forwarded-method': 'GET',
        ...FORGED,
      });
      if (cookie !== undefined) headers.set('cookie', cookie);
      return forwardAuth(
        new Request(`https://${CONTROL_PLANE_HOST}/api/authz/forward`, { headers }),
      );
    };
    expect((await forward('/_platform/inbox')).status).toBe(401);
    signIn(ben);
    const allowed = await forward('/_platform/inbox', COOKIE);
    expect(allowed.status).toBe(200);
    // Ohne Identitaets-Header: Die Route liest die Session selbst.
    expect(allowed.headers.get('x-auth-user-id')).toBeNull();
    for (const path of [
      '/_platform/inbox/mark',
      '/_platform/inbox/',
      '/_platform/inbox/../search',
    ]) {
      expect((await forward(path, COOKIE)).status, path).toBe(403);
    }
  });
});
