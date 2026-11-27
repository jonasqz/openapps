/**
 * Der Weg der Leiste zur Suche (ADR 0021): Browser auf dem Host der Apps ->
 * Traefik (Router `openapps-platform`) -> Forward-Auth -> Control Plane.
 *
 * Riskant ist zweierlei: dass ein Pfad unter `/_platform/` mehr oeffnet als
 * die Suche, und dass die Suche einer Identitaet glaubt, die der Browser
 * selbst schickt. Beides zuerst.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildGatewayConfig,
  createApp,
  gatewayConfigProblems,
  grant,
  PLATFORM_PATH_PREFIX,
  PLATFORM_ROUTER,
  ROUTER_MIDDLEWARES,
  type AppManifest,
  type AppToolInvoker,
} from '../src/domain';
import { GET as forwardAuth } from '../src/app/api/authz/forward/route';
import { resetSessionReader, setSessionReader } from '../src/lib/actor';
import { handlePlatformSearch } from '../src/lib/platform-search-http';
import { setDomainContext } from '../src/lib/runtime';
import { createBetterAuthSessionReader, denyAllSessions } from '../src/lib/session';
import {
  admin,
  createHarness,
  manifest,
  seedBootstrapGrants,
  testGatewaySettings,
  type Harness,
} from './helpers';

const CONTROL_PLANE_HOST = 'control-plane.example.com';
const APPS_DOMAIN = 'apps.example.com';

const ENV: Record<string, string> = {
  DATABASE_URL: 'postgres://unused@localhost:1/none',
  APP_DATABASE_HOST: 'localhost:1/none',
  APPS_DOMAIN,
  CONTROL_PLANE_HOST,
  CONTROL_PLANE_SERVICE_URL: 'http://openapps-control-plane:3000',
  OPENAPPS_AUTH_MASTER_SECRET: 'master-secret-nur-fuer-tests-0123456789',
};

const COOKIE = 'better-auth.session_token=abc';

function sessionFor(user: { id: string; email: string }) {
  return {
    api: {
      getSession(context: { headers: Headers }): Promise<{ user: typeof user } | null> {
        if (context.headers.get('cookie') === null) return Promise.resolve(null);
        return Promise.resolve({ user });
      },
    },
  } as Parameters<typeof createBetterAuthSessionReader>[0]['auth'];
}

function signIn(user: { id: string; email: string }, groups: readonly string[] = []): void {
  setSessionReader(
    createBetterAuthSessionReader({
      auth: sessionFor(user),
      groups: { groupsFor: () => Promise.resolve(groups) },
    }),
  );
}

function forwardRequest(options: { host?: string; path: string; cookie?: string }): Request {
  const headers = new Headers({
    'x-forwarded-host': options.host ?? APPS_DOMAIN,
    'x-forwarded-uri': options.path,
    'x-forwarded-method': 'GET',
  });
  if (options.cookie !== undefined) headers.set('cookie', options.cookie);
  return new Request(`https://${CONTROL_PLANE_HOST}/api/authz/forward`, { headers });
}

function searchable(name: string): AppManifest {
  const base = manifest(name);
  return {
    ...base,
    offeredTools: [
      ...base.offeredTools,
      { name: 'search', description: 'Sucht', verb: 'read', operationId: 'search' },
    ],
    search: { tool: 'search' },
  };
}

/** Wer in der App ankommt: die Identitaet, mit der der Invoker signieren wuerde. */
function echoInvoker(): AppToolInvoker & { seen: string[] } {
  const seen: string[] = [];
  return {
    seen,
    async invoke({ app, actor, humanIdentity }) {
      seen.push(`${app.name}:${actor.kind}:${actor.id}:${humanIdentity?.email ?? '-'}`);
      return { hits: [{ id: '1', title: `In ${app.name}`, url: '/x/1' }] };
    },
  };
}

/** Was ein Browser selbst schicken koennte, um sich als Administrator auszugeben. */
const FORGED = {
  'x-auth-user-id': 'u-admin',
  'x-auth-user-email': 'admin@example.com',
  'x-auth-groups': 'platform-admins',
  'x-auth-issued-at': String(Math.floor(Date.now() / 1000)),
  'x-auth-signature': 'f'.repeat(64),
};

describe('Forward-Auth: Pfade der Plattform auf dem Host der Apps', () => {
  let harness: Harness;
  const previousEnv = new Map<string, string | undefined>();

  beforeEach(async () => {
    for (const [key, value] of Object.entries(ENV)) {
      previousEnv.set(key, process.env[key]);
      process.env[key] = value;
    }
    harness = createHarness({ appsDomain: APPS_DOMAIN });
    await seedBootstrapGrants(harness);
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

  it('gibt ohne Session 401, keine Weiterleitung und keine Header, auch mit gefaelschten', async () => {
    const request = forwardRequest({ path: '/_platform/search?q=angebot' });
    for (const [key, value] of Object.entries(FORGED)) request.headers.set(key, value);
    const response = await forwardAuth(request);
    expect(response.status).toBe(401);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('x-auth-user-id')).toBeNull();
  });

  it('laesst mit Session durch, ohne Identitaets-Header zu setzen', async () => {
    signIn({ id: 'u-lena', email: 'lena@example.com' });
    const response = await forwardAuth(
      forwardRequest({ path: '/_platform/search?q=angebot', cookie: COOKIE }),
    );
    expect(response.status).toBe(200);
    for (const header of ['x-auth-user-id', 'x-auth-signature', 'x-auth-nav']) {
      expect(response.headers.get(header), header).toBeNull();
    }
  });

  it('oeffnet unter /_platform/ nur die Suche, nichts per Praefix oder Umweg', async () => {
    signIn({ id: 'u-admin', email: 'admin@example.com' }, ['platform-admins']);
    for (const path of [
      '/_platform/',
      '/_platform/grants',
      '/_platform/search/',
      '/_platform/search/../../api/grants',
      '/_platform/search/%2e%2e/api/grants',
      '/_platform/%73earch',
      '/_platform/searchx',
    ]) {
      const response = await forwardAuth(forwardRequest({ path, cookie: COOKIE }));
      expect(response.status, path).toBe(403);
    }
  });

  it('gilt nur auf dem Host der Apps, nicht auf einem fremden', async () => {
    signIn({ id: 'u-lena', email: 'lena@example.com' });
    const response = await forwardAuth(
      forwardRequest({ host: 'evil.example.com', path: '/_platform/search', cookie: COOKIE }),
    );
    expect(response.status).toBe(403);
  });
});

describe('GET /api/search bzw. /_platform/search', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = createHarness({ appsDomain: APPS_DOMAIN });
    await seedBootstrapGrants(harness);
    for (const name of ['crm', 'wiki']) {
      await createApp(harness.ctx, { actor: admin, name, manifest: searchable(name) });
    }
    setSessionReader(denyAllSessions);
  });

  afterEach(() => {
    resetSessionReader();
  });

  function searchRequest(query: string, headers: Record<string, string> = {}): Request {
    return new Request(`https://${APPS_DOMAIN}/_platform/search?${query}`, { headers });
  }

  it('glaubt gefaelschten X-Auth-Headern nicht: ohne Session 403 und keine App gefragt', async () => {
    const invoker = echoInvoker();
    const response = await handlePlatformSearch(
      harness.ctx,
      invoker,
      searchRequest('q=angebot', FORGED),
    );
    expect(response.status).toBe(403);
    expect(invoker.seen).toEqual([]);
  });

  it('sucht als die Person aus der Session, auch wenn Header etwas anderes behaupten', async () => {
    await grant(harness.ctx, {
      actor: admin,
      subject: { kind: 'user', id: 'u-lena' },
      verb: 'read',
      resource: { kind: 'app', id: 'crm' },
    });
    signIn({ id: 'u-lena', email: 'lena@example.com' });
    const invoker = echoInvoker();
    const response = await handlePlatformSearch(
      harness.ctx,
      invoker,
      searchRequest('q=angebot', { ...FORGED, cookie: COOKIE }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    // Nur das CRM, nicht das Wiki, das der gefaelschte Administrator lesen duerfte.
    expect(invoker.seen).toEqual(['crm:user:u-lena:lena@example.com']);
    const body = (await response.json()) as {
      results: { app: string; hits: { href: string }[] }[];
      failed: unknown[];
    };
    expect(body.results.map((r) => r.app)).toEqual(['crm']);
    expect(body.results[0]?.hits[0]?.href).toBe(`https://${APPS_DOMAIN}/crm/x/1`);
    expect(body.failed).toEqual([]);
  });

  it('liest apps und limit aus der Adresse und weist falsche Eingaben mit 422 ab', async () => {
    signIn({ id: 'u-admin', email: 'admin@example.com' }, ['platform-admins']);
    const invoker = echoInvoker();
    const ok = await handlePlatformSearch(
      harness.ctx,
      invoker,
      searchRequest('q=angebot&apps=wiki&limit=2', { cookie: COOKIE }),
    );
    expect(ok.status).toBe(200);
    expect(invoker.seen).toEqual(['wiki:user:u-admin:admin@example.com']);

    for (const query of ['q=a', 'q=', 'q=angebot&limit=99', 'q=angebot&limit=zwei']) {
      const bad = await handlePlatformSearch(
        harness.ctx,
        invoker,
        searchRequest(query, { cookie: COOKIE }),
      );
      expect(bad.status, query).toBe(422);
    }
  });
});

describe('Gateway-Konfiguration: Router openapps-platform', () => {
  const input = {
    appsDomain: APPS_DOMAIN,
    apps: [{ appName: 'crm', port: 3000 }],
    ...testGatewaySettings(),
  };

  it('fuehrt /_platform/ auf dem Host der Apps zur Control Plane, mit derselben Kette', () => {
    const config = buildGatewayConfig(input);
    const router = config.http.routers[PLATFORM_ROUTER];
    expect(router?.rule).toBe(
      `Host(\`${APPS_DOMAIN}\`) && PathPrefix(\`${PLATFORM_PATH_PREFIX}\`)`,
    );
    expect(router?.middlewares).toEqual([...ROUTER_MIDDLEWARES]);
    expect(router?.service).toBe('openapps-control-plane');
    expect(router?.tls).toEqual({ certResolver: 'letsencrypt' });
    expect(gatewayConfigProblems(config)).toEqual([]);
  });

  it('gibt es ohne Control Plane nicht', () => {
    const { controlPlane: _ignored, ...withoutControlPlane } = input;
    const config = buildGatewayConfig(withoutControlPlane);
    expect(config.http.routers[PLATFORM_ROUTER]).toBeUndefined();
  });
});
