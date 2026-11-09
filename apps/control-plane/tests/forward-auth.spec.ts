/**
 * Der Forward-Auth-Endpunkt mit einer echten Session (Spec 1.1 und 1.3).
 * Geprueft wird die Pruefkette von hinten: erst was sperren muss.
 *
 * - Session, aber keine Freigabe → 403, nicht 200.
 * - Keine Session → 302 auf den Login.
 * - Die oeffentlichen Pfade aus Spec 1.3 bleiben ohne Session erreichbar,
 *   alles andere auf dem Host der Control Plane nicht.
 * - Gruppen kommen aus der Datenbank: aendert sich die Mitgliedschaft, aendert
 *   sich die naechste Antwort — kein Cache ueber die Session hinaus.
 *
 * Der Session-Leser ist hier ein Double. Dass Better Auth selbst ihn fuellt,
 * steht in `auth-postgres.spec.ts` — das braucht eine echte Datenbank.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp, grant, revoke } from '../src/domain';
import { resetSessionReader, setSessionReader } from '../src/lib/actor';
import { setDomainContext } from '../src/lib/runtime';
import { createBetterAuthSessionReader, denyAllSessions } from '../src/lib/session';
import { admin, createHarness, manifest, seedBootstrapGrants, type Harness } from './helpers';
import { GET, isPublicControlPlanePath } from '../src/app/api/authz/forward/route';

const CONTROL_PLANE_HOST = 'control-plane.example.com';
const BASE_DOMAIN = 'apps.example.com';
const APP_HOST = `projekte.${BASE_DOMAIN}`;

/** Env, die der Endpunkt ueber `readEnv` liest. */
const ENV: Record<string, string> = {
  DATABASE_URL: 'postgres://unused@localhost:1/none',
  APP_DATABASE_HOST: 'localhost:1/none',
  APP_BASE_DOMAIN: BASE_DOMAIN,
  CONTROL_PLANE_HOST,
  FORWARD_AUTH_URL: `https://${CONTROL_PLANE_HOST}/api/authz/forward`,
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

function requestFor(options: { host: string; path?: string; cookie?: string }): Request {
  const headers = new Headers({
    'x-forwarded-host': options.host,
    'x-forwarded-uri': options.path ?? '/',
    'x-forwarded-method': 'GET',
  });
  if (options.cookie !== undefined) headers.set('cookie', options.cookie);
  return new Request(`https://${CONTROL_PLANE_HOST}/api/authz/forward`, { headers });
}

describe('Forward-Auth mit Session', () => {
  let harness: Harness;
  const previousEnv = new Map<string, string | undefined>();

  beforeEach(async () => {
    for (const [key, value] of Object.entries(ENV)) {
      previousEnv.set(key, process.env[key]);
      process.env[key] = value;
    }
    harness = createHarness({ baseDomain: BASE_DOMAIN });
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

  async function appOnHost(): Promise<{ id: string }> {
    await createApp(harness.ctx, {
      actor: admin,
      name: 'projekte',
      manifest: manifest('projekte'),
    });
    // `createApp` setzt die Domain erst nach dem Anlegen, also neu lesen.
    const app = await harness.ctx.apps.findByName('projekte');
    if (app === null) throw new Error('App projekte wurde nicht angelegt');
    expect(app.primaryDomain).toBe(APP_HOST);
    return app;
  }

  it('gibt 403, wenn ein Nutzer eine Session hat, aber keine Freigabe', async () => {
    await appOnHost();
    setSessionReader(
      createBetterAuthSessionReader({
        auth: sessionFor({ id: 'u-lena', email: 'lena@example.com' }),
        groups: membershipTable({ 'lena@example.com': ['team'] }),
      }),
    );

    const response = await GET(requestFor({ host: APP_HOST, cookie: 'better-auth.session=abc' }));
    expect(response.status).toBe(403);
    expect(response.headers.get('x-auth-user-id')).toBeNull();
  });

  it('gibt ohne Session 302 auf den Login', async () => {
    await appOnHost();
    const response = await GET(requestFor({ host: APP_HOST, path: '/projekte/1' }));
    expect(response.status).toBe(302);
    const location = response.headers.get('location');
    expect(location).toContain('/login');
    expect(location).toContain(encodeURIComponent(`https://${APP_HOST}/projekte/1`));
  });

  it('gibt 403 fuer eine Domain ohne App, auch mit gueltiger Session', async () => {
    setSessionReader(
      createBetterAuthSessionReader({
        auth: sessionFor({ id: 'u-chef', email: 'chef@example.com' }),
        groups: membershipTable({ 'chef@example.com': ['platform-admins'] }),
      }),
    );
    const response = await GET(
      requestFor({ host: `fremd.${BASE_DOMAIN}`, cookie: 'better-auth.session=abc' }),
    );
    expect(response.status).toBe(403);
  });

  it('nimmt die Gruppen aus der Datenbank: eine Aenderung wirkt beim naechsten Aufruf', async () => {
    const app = await appOnHost();
    const memberships = membershipTable({ 'lena@example.com': [] });
    setSessionReader(
      createBetterAuthSessionReader({
        auth: sessionFor({ id: 'u-lena', email: 'lena@example.com' }),
        groups: memberships,
      }),
    );
    const call = (): Promise<Response> =>
      GET(requestFor({ host: APP_HOST, cookie: 'better-auth.session=abc' }));

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
      expect(response.headers.get('location'), path).toContain('/login');
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
    await appOnHost();
    setSessionReader(
      createBetterAuthSessionReader({
        auth: sessionFor({ id: '', email: '' }),
        groups: membershipTable(),
      }),
    );
    const response = await GET(requestFor({ host: APP_HOST, cookie: 'better-auth.session=abc' }));
    expect(response.status).toBe(302);
  });
});
