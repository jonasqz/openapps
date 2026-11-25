/**
 * Der Forward-Auth-Endpunkt mit einer echten Session (Spec 1.1 und 1.3).
 * Geprueft wird die Pruefkette von hinten: erst was sperren muss.
 *
 * - Session, aber keine Freigabe → 403, nicht 200.
 * - Die App haengt am **Pfad**, nicht an einer Subdomain (ADR 0007): ein Pfad
 *   ohne App ist 403, auch fuer den Administrator.
 * - Keine Session → 302 auf den Login.
 * - Die oeffentlichen Pfade aus Spec 1.3 bleiben ohne Session erreichbar,
 *   alles andere auf dem Host der Control Plane nicht.
 * - Gruppen kommen aus der Datenbank: aendert sich die Mitgliedschaft, aendert
 *   sich die naechste Antwort — kein Cache ueber die Session hinaus.
 *
 * Der Session-Leser ist hier ein Double. Dass Better Auth selbst ihn fuellt,
 * steht in `auth-postgres.spec.ts` — das braucht eine echte Datenbank.
 */

import { getNavigation, NAV_HEADER, NAV_SIGNATURE_HEADER } from '@openapps/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appAuthSecret, createApp, grant, revoke } from '../src/domain';
import { resetSessionReader, setSessionReader } from '../src/lib/actor';
import { setDomainContext } from '../src/lib/runtime';
import { createBetterAuthSessionReader, denyAllSessions } from '../src/lib/session';
import { admin, createHarness, manifest, seedBootstrapGrants, type Harness } from './helpers';
import { GET, isPublicControlPlanePath } from '../src/app/api/authz/forward/route';

const CONTROL_PLANE_HOST = 'control-plane.example.com';
/** Die eine Domain, unter der alle Apps liegen (ADR 0007). */
const APPS_DOMAIN = 'apps.example.com';
/** Der Pfad der App `projekte` — abgeleitet, nicht erfunden. */
const APP_PATH = '/projekte';

/** Env, die der Endpunkt ueber `readEnv` liest. */
const ENV: Record<string, string> = {
  DATABASE_URL: 'postgres://unused@localhost:1/none',
  APP_DATABASE_HOST: 'localhost:1/none',
  APPS_DOMAIN,
  CONTROL_PLANE_HOST,
  FORWARD_AUTH_URL: `https://${CONTROL_PLANE_HOST}/api/authz/forward`,
  // Pflicht: ohne sie schreibt der Generator keinen Router fuer die Control
  // Plane, und readEnv verweigert den Start. Dass die Route dann 403 liefert
  // statt 302, ist richtig — im Zweifel geschlossen.
  CONTROL_PLANE_SERVICE_URL: 'http://openapps-control-plane:3000',
  OPENAPPS_AUTH_MASTER_SECRET: 'master-secret-nur-fuer-tests-0123456789',
};

/** Mitgliedschaften wie in `group_members` — hier im Speicher, aber ohne Cache. */
function membershipTable(initial: Record<string, readonly string[]> = {}) {
  const table = new Map<string, readonly string[]>(Object.entries(initial));
  return {
    set(email: string, groups: readonly string[]): void {
      table.set(email, groups);
    },
    groupsFor(email: string): Promise<readonly string[]> {
      return Promise.resolve(table.get(email) ?? []);
    },
  };
}

/** Ein Double von `auth.api.getSession` mit genau einer Session. */
function sessionFor(user: { id: string; email: string } | null) {
  return {
    api: {
      getSession(context: { headers: Headers }): Promise<{ user: typeof user } | null> {
        // Ohne Cookie keine Session — genau wie Better Auth.
        if (context.headers.get('cookie') === null) return Promise.resolve(null);
        return Promise.resolve(user === null ? null : { user });
      },
    },
  } as Parameters<typeof createBetterAuthSessionReader>[0]['auth'];
}

function requestFor(options: {
  host: string;
  path?: string;
  cookie?: string;
  /**
   * Die Adresse, unter der die Route **aufgerufen** wird. Default ist die
   * oeffentliche; im Betrieb ruft Traefik sie unter ihrem container-internen
   * Namen auf, und darauf darf keine Antwort aufbauen (siehe den Test zum
   * Login-Redirect).
   */
  requestUrl?: string;
}): Request {
  const headers = new Headers({
    'x-forwarded-host': options.host,
    'x-forwarded-uri': options.path ?? '/',
    'x-forwarded-method': 'GET',
  });
  if (options.cookie !== undefined) headers.set('cookie', options.cookie);
  return new Request(options.requestUrl ?? `https://${CONTROL_PLANE_HOST}/api/authz/forward`, {
    headers,
  });
}

describe('Forward-Auth mit Session', () => {
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

  /**
   * Die App liegt auf der gemeinsamen Domain, erreichbar unter ihrem Pfad.
   * Keine Subdomain mehr: `primaryDomain` ist die Domain selbst (ADR 0007).
   */
  async function appOnPath(): Promise<{ id: string }> {
    await createApp(harness.ctx, {
      actor: admin,
      name: 'projekte',
      manifest: manifest('projekte'),
    });
    // `createApp` setzt die Domain erst nach dem Anlegen, also neu lesen.
    const app = await harness.ctx.apps.findByName('projekte');
    if (app === null) throw new Error('App projekte wurde nicht angelegt');
    expect(app.primaryDomain).toBe(APPS_DOMAIN);
    return app;
  }

  /** Ein Aufruf auf die App: gemeinsame Domain, Pfad der App. */
  function appRequest(options?: { path?: string; cookie?: string; requestUrl?: string }): Request {
    return requestFor({
      host: APPS_DOMAIN,
      path: options?.path ?? APP_PATH,
      ...(options?.cookie === undefined ? {} : { cookie: options.cookie }),
      ...(options?.requestUrl === undefined ? {} : { requestUrl: options.requestUrl }),
    });
  }

  it('gibt 403, wenn ein Nutzer eine Session hat, aber keine Freigabe', async () => {
    await appOnPath();
    setSessionReader(
      createBetterAuthSessionReader({
        auth: sessionFor({ id: 'u-lena', email: 'lena@example.com' }),
        groups: membershipTable({ 'lena@example.com': ['team'] }),
      }),
    );

    const response = await GET(appRequest({ cookie: 'better-auth.session=abc' }));
    expect(response.status).toBe(403);
    expect(response.headers.get('x-auth-user-id')).toBeNull();
  });

  it('gibt ohne Session 302 auf den Login', async () => {
    await appOnPath();
    const response = await GET(appRequest({ path: `${APP_PATH}/1` }));
    expect(response.status).toBe(302);
    const location = response.headers.get('location');
    expect(location).toBe(
      `https://${CONTROL_PLANE_HOST}/login?next=${encodeURIComponent(
        `https://${APPS_DOMAIN}${APP_PATH}/1`,
      )}`,
    );
  });

  /**
   * Der Fall, der im Betrieb zuschlaegt und den kein anderer Test sieht:
   * Traefik ruft diese Route unter dem **container-internen** Namen auf. Baut
   * der Redirect seine Adresse aus `request.url`, schickt er den Browser an
   * `http://openapps-control-plane:3000/login` — einen Namen, den es im Netz
   * des Nutzers nicht gibt. Der Login waere genau dann unerreichbar, wenn er
   * gebraucht wird.
   */
  it('nimmt den Login-Host aus der Env, nicht aus der Adresse des Aufrufs', async () => {
    await appOnPath();
    const response = await GET(
      appRequest({
        path: APP_PATH,
        requestUrl: 'http://openapps-control-plane:3000/api/authz/forward',
      }),
    );

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '');
    expect(location.host).toBe(CONTROL_PLANE_HOST);
    expect(location.protocol).toBe('https:');
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('next')).toBe(`https://${APPS_DOMAIN}${APP_PATH}`);
  });

  it('gibt 403 fuer jeden Pfad ohne App, auch mit Freigabe auf alles', async () => {
    await appOnPath();
    setSessionReader(
      createBetterAuthSessionReader({
        auth: sessionFor({ id: 'u-chef', email: 'chef@example.com' }),
        groups: membershipTable({ 'chef@example.com': ['platform-admins'] }),
      }),
    );
    // Der Administrator hat `*` auf alle Apps (seedBootstrapGrants). Trotzdem
    // oeffnet kein Pfad, hinter dem keine App steht — auch die Wurzel der
    // gemeinsamen Domain nicht. Default-Deny haengt am Pfad, nicht am Nutzer.
    for (const path of ['/', '/fremd', '/fremd/tief', '/PROJEKTE', '/projekte%2f..', '']) {
      const response = await GET(appRequest({ path, cookie: 'better-auth.session=abc' }));
      expect(response.status, path).toBe(403);
    }
  });

  it('gibt 403, wenn die App auf einer anderen Domain liegt als der Aufruf', async () => {
    await appOnPath();
    setSessionReader(
      createBetterAuthSessionReader({
        auth: sessionFor({ id: 'u-chef', email: 'chef@example.com' }),
        groups: membershipTable({ 'chef@example.com': ['platform-admins'] }),
      }),
    );
    // Derselbe Pfad, fremder Host: Die Domain bleibt Teil der Entscheidung,
    // obwohl sie fuer alle Apps dieselbe ist.
    const response = await GET(
      requestFor({ host: 'fremd.example.com', path: APP_PATH, cookie: 'better-auth.session=abc' }),
    );
    expect(response.status).toBe(403);
  });

  it('nimmt die Gruppen aus der Datenbank: eine Aenderung wirkt beim naechsten Aufruf', async () => {
    const app = await appOnPath();
    const memberships = membershipTable({ 'lena@example.com': [] });
    setSessionReader(
      createBetterAuthSessionReader({
        auth: sessionFor({ id: 'u-lena', email: 'lena@example.com' }),
        groups: memberships,
      }),
    );
    const call = (): Promise<Response> => GET(appRequest({ cookie: 'better-auth.session=abc' }));

    // Die Freigabe haengt an der Gruppe, nicht an der Person.
    const granted = await grant(harness.ctx, {
      actor: admin,
      subject: { kind: 'group', id: 'team' },
      verb: 'read',
      resource: { kind: 'app', id: app.id },
    });

    // 1. ohne Mitgliedschaft: gesperrt
    expect((await call()).status).toBe(403);

    // 2. Mitgliedschaft dazu — dieselbe Session, dasselbe Cookie
    memberships.set('lena@example.com', ['team']);
    const allowed = await call();
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get('x-auth-groups')).toBe('team');
    expect(allowed.headers.get('x-auth-user-id')).toBe('u-lena');
    expect(allowed.headers.get('x-auth-signature')).not.toBeNull();

    // 3. Mitgliedschaft weg: sofort wieder gesperrt, ohne neuen Login
    memberships.set('lena@example.com', []);
    expect((await call()).status).toBe(403);

    // 4. und auch der Widerruf der Freigabe wirkt sofort
    memberships.set('lena@example.com', ['team']);
    expect((await call()).status).toBe(200);
    await revoke(harness.ctx, { actor: admin, grantId: granted.id });
    expect((await call()).status).toBe(403);
  });

  it('laesst die oeffentlichen Pfade aus Spec 1.3 ohne Session durch', async () => {
    for (const path of [
      '/login',
      '/login?next=%2Fgrants',
      '/api/auth/sign-in/social',
      '/api/auth/callback/google?code=x',
      '/api/authz/forward',
      '/healthz',
      '/_next/static/chunks/main.js',
    ]) {
      const response = await GET(requestFor({ host: CONTROL_PLANE_HOST, path }));
      expect(response.status, path).toBe(200);
    }
  });

  it('sperrt alles andere auf dem Host der Control Plane ohne Session', async () => {
    for (const path of [
      '/',
      '/grants',
      '/api/grants',
      '/api/apps',
      '/api/authz',
      '/loginx',
      '/_next/server/app/page.js',
      '/api/auth-nicht-wirklich',
    ]) {
      const response = await GET(requestFor({ host: CONTROL_PLANE_HOST, path }));
      expect(response.status, path).toBe(302);
      const location = new URL(response.headers.get('location') ?? '');
      expect(`${location.origin}${location.pathname}`, path).toBe(
        `https://${CONTROL_PLANE_HOST}/login`,
      );
    }
  });

  it('kennt genau die Allowlist aus Spec 1.3 — ohne Pfad-Trick', () => {
    expect(isPublicControlPlanePath('/api/auth/callback/google')).toBe(true);
    expect(isPublicControlPlanePath('/api/auth')).toBe(false);
    expect(isPublicControlPlanePath('/api/authz/forward')).toBe(true);
    expect(isPublicControlPlanePath('/api/grants')).toBe(false);
    // Fund beim Schreiben dieses Tests: der reine Praefix-Vergleich hielt
    // `/login/../grants` fuer oeffentlich. Jetzt nicht mehr — auch nicht
    // doppelt kodiert.
    expect(isPublicControlPlanePath('/login/../grants')).toBe(false);
    expect(isPublicControlPlanePath('/login/%2e%2e/grants')).toBe(false);
    expect(isPublicControlPlanePath('/_next/static/../../grants')).toBe(false);
    expect(isPublicControlPlanePath('grants')).toBe(false);
    // Der Plattform-MCP: genau dieser Pfad, kein Nachbar und kein Umweg.
    expect(isPublicControlPlanePath('/mcp')).toBe(true);
    expect(isPublicControlPlanePath('/mcp-admin')).toBe(false);
    expect(isPublicControlPlanePath('/mcp/../grants')).toBe(false);
    expect(isPublicControlPlanePath('/mcp/../api/agents')).toBe(false);
  });

  it('laesst die Control Plane mit Session durch, auch ohne App-Freigabe', async () => {
    setSessionReader(
      createBetterAuthSessionReader({
        auth: sessionFor({ id: 'u-lena', email: 'lena@example.com' }),
        groups: membershipTable(),
      }),
    );
    const response = await GET(
      requestFor({ host: CONTROL_PLANE_HOST, path: '/grants', cookie: 'better-auth.session=abc' }),
    );
    // Die Seite selbst entscheidet dann ueber die Freigabe (listGrants prueft
    // `can`) — der Endpunkt laesst nur den angemeldeten Nutzer an den Host.
    expect(response.status).toBe(200);
  });

  it('verwirft eine Session ohne Identitaet', async () => {
    await appOnPath();
    setSessionReader(
      createBetterAuthSessionReader({
        auth: sessionFor({ id: '', email: '' }),
        groups: membershipTable(),
      }),
    );
    const response = await GET(appRequest({ cookie: 'better-auth.session=abc' }));
    expect(response.status).toBe(302);
  });

  /* ------------------------------------------------------------------------ */
  /* Navigation der gemeinsamen Leiste (ADR 0017)                              */
  /* ------------------------------------------------------------------------ */

  /** Liest die Navigation so, wie die App `projekte` sie liest. */
  function navAsApp(response: Response, appName = 'projekte') {
    return getNavigation(response.headers, {
      secret: appAuthSecret({
        masterSecret: ENV.OPENAPPS_AUTH_MASTER_SECRET ?? '',
        appId: appName,
        generation: 1,
      }),
      appId: appName,
      appHost: APPS_DOMAIN,
      now: () => harness.ctx.clock.now().getTime(),
    });
  }

  async function zweiteApp(name: string): Promise<void> {
    await createApp(harness.ctx, { actor: admin, name, manifest: manifest(name) });
  }

  function alsLena(groups: readonly string[] = []): void {
    setSessionReader(
      createBetterAuthSessionReader({
        auth: sessionFor({ id: 'u-lena', email: 'lena@example.com' }),
        groups: membershipTable({ 'lena@example.com': groups }),
      }),
    );
  }

  it('gibt der Leiste nur die Apps, die die Person lesen darf', async () => {
    const app = await appOnPath();
    await zweiteApp('aufgaben');
    await zweiteApp('geheim');
    await grant(harness.ctx, {
      actor: admin,
      subject: { kind: 'user', id: 'u-lena' },
      verb: 'read',
      resource: { kind: 'app', id: app.id },
    });
    // Freigabe auf den Namen statt die Id: zaehlt genauso (canAccessApp).
    await grant(harness.ctx, {
      actor: admin,
      subject: { kind: 'group', id: 'team' },
      verb: 'read',
      resource: { kind: 'app', id: 'aufgaben' },
    });
    alsLena(['team']);

    const response = await GET(appRequest({ cookie: 'better-auth.session=abc' }));
    expect(response.status).toBe(200);
    const nav = navAsApp(response);
    expect(nav).not.toBeNull();
    expect(nav?.apps.map((a) => a.name).sort()).toEqual(['aufgaben', 'projekte']);
    expect(nav?.apps.find((a) => a.name === 'projekte')).toEqual({
      name: 'projekte',
      title: 'projekte',
      category: 'test',
      href: `https://${APPS_DOMAIN}${APP_PATH}`,
    });
    expect(nav?.platformUrl).toBe(`https://${CONTROL_PLANE_HOST}`);
    // Keine Freigabe auf `app:*`, keine Mitgliedschaft in platform-admins.
    expect(nav?.canCreateApps).toBe(false);
    expect(nav?.isAdmin).toBe(false);
  });

  it('bindet die Navigation an die aufgerufene App', async () => {
    const app = await appOnPath();
    await grant(harness.ctx, {
      actor: admin,
      subject: { kind: 'user', id: 'u-lena' },
      verb: 'read',
      resource: { kind: 'app', id: app.id },
    });
    alsLena();
    const response = await GET(appRequest({ cookie: 'better-auth.session=abc' }));
    expect(response.status).toBe(200);
    // Mit dem Secret einer anderen App gelesen: keine Navigation.
    expect(navAsApp(response, 'aufgaben')).toBeNull();
  });

  it('zeigt dem Administrator alle Apps und dass er Apps anlegen darf', async () => {
    await appOnPath();
    await zweiteApp('aufgaben');
    setSessionReader(
      createBetterAuthSessionReader({
        auth: sessionFor({ id: 'u-chef', email: 'chef@example.com' }),
        groups: membershipTable({ 'chef@example.com': ['platform-admins'] }),
      }),
    );
    const response = await GET(appRequest({ cookie: 'better-auth.session=abc' }));
    const nav = navAsApp(response);
    expect(nav?.apps.map((a) => a.name).sort()).toEqual(['aufgaben', 'projekte']);
    expect(nav?.canCreateApps).toBe(true);
    expect(nav?.isAdmin).toBe(true);
  });

  it('gibt bei einem Nein keine Navigation mit', async () => {
    await appOnPath();
    await zweiteApp('aufgaben');
    await grant(harness.ctx, {
      actor: admin,
      subject: { kind: 'user', id: 'u-lena' },
      verb: 'read',
      resource: { kind: 'app', id: 'aufgaben' },
    });
    alsLena();
    const response = await GET(appRequest({ cookie: 'better-auth.session=abc' }));
    expect(response.status).toBe(403);
    expect(response.headers.get(NAV_HEADER)).toBeNull();
    expect(response.headers.get(NAV_SIGNATURE_HEADER)).toBeNull();
  });

  it('laesst durch und setzt beide Nav-Header leer, wenn die Navigation scheitert', async () => {
    const app = await appOnPath();
    await grant(harness.ctx, {
      actor: admin,
      subject: { kind: 'user', id: 'u-lena' },
      verb: 'read',
      resource: { kind: 'app', id: app.id },
    });
    alsLena();
    // Die Liste aller Apps braucht nur die Navigation, nicht die Entscheidung.
    const apps = harness.ctx.apps as { listAll: () => Promise<unknown> };
    const original = apps.listAll;
    apps.listAll = () => Promise.reject(new Error('db weg'));
    try {
      const response = await GET(appRequest({ cookie: 'better-auth.session=abc' }));
      expect(response.status).toBe(200);
      expect(response.headers.get('x-auth-user-id')).toBe('u-lena');
      expect(response.headers.get(NAV_HEADER)).toBe('');
      expect(response.headers.get(NAV_SIGNATURE_HEADER)).toBe('');
      expect(navAsApp(response)).toBeNull();
    } finally {
      apps.listAll = original;
    }
  });
});
