/**
 * Der Ansehen-Proxy fuer die Control Plane (ADR 0014). Riskant ist, dass er
 * Sessions ohne Google erzeugt. Geprueft wird deshalb:
 *
 * 1. Die Session nimmt das echte Better Auth an (gegen Postgres), und die
 *    Hooks laufen mit: Der Admin landet in `platform-admins`, der Nutzer in
 *    keiner Gruppe, und eine Adresse ausserhalb der Domains bekommt nichts.
 * 2. Eine fremde Seite kann ueber den Proxy nichts schreiben.
 * 3. Das Cookie des Browsers geht nie nach innen, nur die eigene Session.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGroupMembershipRepository } from '../src/infra/pg';
import {
  buildCpForward,
  emailFuerRolle,
  FremdeHerkunftError,
  lokaleSession,
  rewriteLocation,
  rolleAusCookie,
  rollenwechsel,
  signSessionToken,
  type LokalAuth,
} from '../src/infra/lokal-ansehen-cp';
import { createAuth } from '../src/lib/auth';
import { BOOTSTRAP_GROUP } from '../src/lib/auth-policy';
import type { AuthEnv } from '../src/lib/env';
import { createBetterAuthSessionReader } from '../src/lib/session';
import { freshDatabase, postgresReachable, type PgFixture } from './pg-helpers';

const env: AuthEnv = {
  secret: 'test-better-auth-secret-0123456789abcdef',
  baseUrl: 'https://cp.local.test:8443',
  googleClientId: 'lokal-ohne-google',
  googleClientSecret: 'lokal-ohne-google',
  allowedEmailDomains: ['example.com'],
  bootstrapAdmins: ['admin@example.com'],
};

const SESSION = { cookieName: '__Secure-better-auth.session_token', value: 'abc.sig' };
const forward = (method: string, incoming: Record<string, string>) =>
  buildCpForward({
    method,
    path: '/grants',
    incoming,
    session: SESSION,
    cpOrigin: env.baseUrl,
    upstream: 'http://openapps-control-plane:3000',
  });

describe('Ansehen-Proxy fuer die Control Plane: Weiterleitung', () => {
  it('laesst eine schreibende Anfrage von fremder Herkunft nicht durch', () => {
    expect(() => forward('POST', { origin: 'https://boese.example' })).toThrow(FremdeHerkunftError);
    expect(() => forward('DELETE', {})).toThrow(FremdeHerkunftError);
  });

  it('laesst eigene schreibende Anfragen durch, mit der Origin der Control Plane', () => {
    const out = forward('POST', { origin: 'http://127.0.0.1:8091' });
    expect(out.headers.origin).toBe('https://cp.local.test:8443');
    expect(out.headers['x-forwarded-host']).toBe('cp.local.test:8443');
  });

  it('schickt nur die eigene Session nach innen, nie Cookies oder Identitaet des Browsers', () => {
    const out = forward('GET', {
      cookie: '__Secure-better-auth.session_token=gestohlen; openapps_local_role=user',
      authorization: 'Bearer fremd',
      'x-auth-user-id': 'admin',
      'X-Auth-Nav': 'eyJ2IjoxfQ',
      'x-auth-nav-signature': 'gefaelscht',
      accept: 'text/html',
    });
    expect(out.headers.cookie).toBe(`${SESSION.cookieName}=${SESSION.value}`);
    expect(out.headers.authorization).toBeUndefined();
    expect(out.headers['x-auth-user-id']).toBeUndefined();
    expect(out.headers['x-auth-nav']).toBeUndefined();
    expect(out.headers['x-auth-nav-signature']).toBeUndefined();
    expect(out.headers.accept).toBe('text/html');
    expect(out.url).toBe('http://openapps-control-plane:3000/grants');
  });

  it('liest Rolle und Rollenwechsel nur aus festen Werten', () => {
    expect(rolleAusCookie('openapps_local_role=user')).toBe('user');
    expect(rolleAusCookie('openapps_local_role=root')).toBe('admin');
    // Der alte Cookie-Name gilt nicht mehr: ohne gueltiges Cookie bleibt es admin.
    expect(rolleAusCookie('openapps_lokal_rolle=user')).toBe('admin');
    expect(rolleAusCookie(undefined)).toBe('admin');
    expect(rollenwechsel('/_local/as/user')).toBe('user');
    expect(rollenwechsel('/_local/as/admin')).toBe('admin');
    expect(rollenwechsel('/_local/as/root')).toBeNull();
    // Die alten Pfade schalten nichts mehr um.
    expect(rollenwechsel('/_lokal/als/nutzer')).toBeNull();
    expect(rollenwechsel('/_local/as/nutzer')).toBeNull();
    expect(rollenwechsel('/grants')).toBeNull();
  });

  it('biegt Weiterleitungen auf die Control Plane zum Proxy zurueck', () => {
    expect(rewriteLocation('https://cp.local.test:8443/login', env.baseUrl)).toBe('/login');
    expect(rewriteLocation('https://cp.local.test:8443', env.baseUrl)).toBe('/');
    expect(rewriteLocation('https://accounts.google.com/x', env.baseUrl)).toBe(
      'https://accounts.google.com/x',
    );
  });

  it('nimmt die Adressen aus der Auth-Env', () => {
    expect(emailFuerRolle('admin', env)).toBe('admin@example.com');
    expect(emailFuerRolle('user', env)).toBe('user@example.com');
    expect(() => emailFuerRolle('admin', { ...env, bootstrapAdmins: [] })).toThrow();
  });
});

const reachable = await postgresReachable();

describe.skipIf(!reachable)('Ansehen-Proxy fuer die Control Plane: Sessions gegen Postgres', () => {
  let db: PgFixture;

  beforeEach(async () => {
    db = await freshDatabase();
  });

  afterEach(async () => {
    await db.close();
  });

  const read = async (auth: ReturnType<typeof createAuth>, cookie: string) =>
    createBetterAuthSessionReader({
      auth,
      groups: createGroupMembershipRepository(db.pool),
    }).read(new Request('https://cp.local.test:8443/', { headers: { cookie } }));

  it('erzeugt eine Session, die Better Auth annimmt, und der Admin ist in platform-admins', async () => {
    const auth = createAuth({ pool: db.pool, env });
    const session = await lokaleSession(auth as unknown as LokalAuth, emailFuerRolle('admin', env));
    expect(session.cookieName).toBe('__Secure-better-auth.session_token');

    const user = await read(auth, `${session.cookieName}=${session.value}`);
    expect(user?.email).toBe('admin@example.com');
    expect(user?.groups).toContain(BOOTSTRAP_GROUP);
  });

  it('gibt dem Nutzer eine Session ohne Gruppe', async () => {
    const auth = createAuth({ pool: db.pool, env });
    const session = await lokaleSession(auth as unknown as LokalAuth, emailFuerRolle('user', env));
    const user = await read(auth, `${session.cookieName}=${session.value}`);
    expect(user?.email).toBe('user@example.com');
    expect(user?.groups).toEqual([]);
  });

  it('nimmt eine falsch signierte Session nicht an', async () => {
    const auth = createAuth({ pool: db.pool, env });
    const session = await lokaleSession(auth as unknown as LokalAuth, 'admin@example.com');
    const token = decodeURIComponent(session.value).split('.')[0] ?? '';
    const forged = signSessionToken(token, 'falsches-secret-0123456789abcdefghij');
    expect(await read(auth, `${session.cookieName}=${forged}`)).toBeNull();
  });

  it('gibt einer Adresse ausserhalb der erlaubten Domains keine Session', async () => {
    const auth = createAuth({ pool: db.pool, env });
    await expect(lokaleSession(auth as unknown as LokalAuth, 'eve@evil.com')).rejects.toThrow();
  });
});
