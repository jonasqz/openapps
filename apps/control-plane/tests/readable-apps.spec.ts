/**
 * Die lesbaren Apps als signierter Kontext der Forward-Auth (ADR 0020).
 *
 * Riskant ist, dass eine App Inhalte aus Apps zeigt, die die Person nicht
 * lesen darf. Geprueft wird deshalb zuerst, was fehlen muss: Apps ohne
 * Freigabe, archivierte Apps, die Liste fuer eine App ohne Anforderung, die
 * Liste bei einem Fehler, die Liste mit dem Secret einer anderen App.
 */

import {
  getReadableApps,
  READABLE_APPS_HEADER,
  READABLE_APPS_SIGNATURE_HEADER,
} from '@openapps/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appAuthSecret,
  createApp,
  fitReadableApps,
  grant,
  READABLE_APPS_HEADER_BUDGET,
  readableAppsFor,
  type AppManifest,
} from '../src/domain';
import { GET } from '../src/app/api/authz/forward/route';
import { resetSessionReader, setSessionReader } from '../src/lib/actor';
import { setDomainContext } from '../src/lib/runtime';
import { createBetterAuthSessionReader, denyAllSessions } from '../src/lib/session';
import { admin, createHarness, manifest, seedBootstrapGrants, type Harness } from './helpers';

const CONTROL_PLANE_HOST = 'control-plane.example.com';
const APPS_DOMAIN = 'apps.example.com';
const MASTER = 'master-secret-nur-fuer-tests-0123456789';

const ENV: Record<string, string> = {
  DATABASE_URL: 'postgres://unused@localhost:1/none',
  APP_DATABASE_HOST: 'localhost:1/none',
  APPS_DOMAIN,
  CONTROL_PLANE_HOST,
  CONTROL_PLANE_SERVICE_URL: 'http://openapps-control-plane:3000',
  OPENAPPS_AUTH_MASTER_SECRET: MASTER,
};

function searchManifest(name: string): AppManifest {
  return { ...manifest(name), gatewayContext: ['readableApps'] };
}

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

describe('Forward-Auth: lesbare Apps', () => {
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

  function asLena(groups: readonly string[] = []): void {
    setSessionReader(
      createBetterAuthSessionReader({
        auth: sessionFor({ id: 'u-lena', email: 'lena@example.com' }),
        groups: { groupsFor: () => Promise.resolve(groups) },
      }),
    );
  }

  async function app(name: string, withContext = false): Promise<void> {
    await createApp(harness.ctx, {
      actor: admin,
      name,
      manifest: withContext ? searchManifest(name) : manifest(name),
    });
  }

  async function lenaMayRead(name: string): Promise<void> {
    await grant(harness.ctx, {
      actor: admin,
      subject: { kind: 'user', id: 'u-lena' },
      verb: 'read',
      resource: { kind: 'app', id: name },
    });
  }

  function request(appName: string): Request {
    return new Request(`https://${CONTROL_PLANE_HOST}/api/authz/forward`, {
      headers: {
        'x-forwarded-host': APPS_DOMAIN,
        'x-forwarded-uri': `/${appName}`,
        cookie: 'better-auth.session=abc',
      },
    });
  }

  function readAs(response: Response, appName: string): readonly string[] | null {
    return getReadableApps(response.headers, {
      secret: appAuthSecret({ masterSecret: MASTER, appId: appName, generation: 1 }),
      appId: appName,
      appHost: APPS_DOMAIN,
      now: () => harness.ctx.clock.now().getTime(),
    });
  }

  it('nennt nur Apps, die die Person lesen darf', async () => {
    await app('knowledge', true);
    await app('wiki');
    await app('geheim');
    await lenaMayRead('knowledge');
    await lenaMayRead('wiki');
    asLena();

    const response = await GET(request('knowledge'));
    expect(response.status).toBe(200);
    expect(readAs(response, 'knowledge')).toEqual(['knowledge', 'wiki']);
  });

  it('zaehlt Freigaben ueber Gruppen wie die Forward-Auth', async () => {
    await app('knowledge', true);
    await app('wiki');
    await lenaMayRead('knowledge');
    await grant(harness.ctx, {
      actor: admin,
      subject: { kind: 'group', id: 'team' },
      verb: 'read',
      resource: { kind: 'app', id: 'wiki' },
    });
    asLena(['team']);
    expect(readAs(await GET(request('knowledge')), 'knowledge')).toEqual(['knowledge', 'wiki']);
  });

  it('laesst archivierte Apps weg', async () => {
    await app('knowledge', true);
    await app('wiki');
    await lenaMayRead('knowledge');
    await lenaMayRead('wiki');
    // Archiviert wird ueber das Register; hier reicht, was `listAll` liefert.
    const all = await harness.ctx.apps.listAll();
    const original = harness.ctx.apps.listAll.bind(harness.ctx.apps);
    (harness.ctx.apps as { listAll: () => Promise<unknown> }).listAll = async () =>
      all.map((a) => (a.name === 'wiki' ? { ...a, archivedAt: new Date() } : a));
    try {
      expect(await readableAppsFor(harness.ctx, { kind: 'user', id: 'u-lena' })).toEqual([
        'knowledge',
      ]);
    } finally {
      (harness.ctx.apps as { listAll: () => Promise<unknown> }).listAll = original;
    }
  });

  it('setzt beide Header leer fuer eine App ohne Anforderung im Manifest', async () => {
    await app('crm');
    await app('wiki');
    await lenaMayRead('crm');
    await lenaMayRead('wiki');
    asLena();
    const response = await GET(request('crm'));
    expect(response.status).toBe(200);
    expect(response.headers.get(READABLE_APPS_HEADER)).toBe('');
    expect(response.headers.get(READABLE_APPS_SIGNATURE_HEADER)).toBe('');
    expect(readAs(response, 'crm')).toBeNull();
  });

  it('ist an die aufgerufene App gebunden: mit dem Secret einer anderen App null', async () => {
    await app('knowledge', true);
    await lenaMayRead('knowledge');
    asLena();
    const response = await GET(request('knowledge'));
    expect(readAs(response, 'wiki')).toBeNull();
  });

  it('laesst durch und setzt die Header leer, wenn die Liste nicht berechnet werden kann', async () => {
    await app('knowledge', true);
    await lenaMayRead('knowledge');
    asLena();
    const apps = harness.ctx.apps as { listAll: () => Promise<unknown> };
    const original = apps.listAll;
    apps.listAll = () => Promise.reject(new Error('db weg'));
    try {
      const response = await GET(request('knowledge'));
      expect(response.status).toBe(200);
      expect(response.headers.get('x-auth-user-id')).toBe('u-lena');
      expect(response.headers.get(READABLE_APPS_HEADER)).toBe('');
      expect(readAs(response, 'knowledge')).toBeNull();
    } finally {
      apps.listAll = original;
    }
  });

  it('gibt bei einem Nein keine Liste mit', async () => {
    await app('knowledge', true);
    await app('wiki');
    await lenaMayRead('wiki');
    asLena();
    const response = await GET(request('knowledge'));
    expect(response.status).toBe(403);
    expect(response.headers.get(READABLE_APPS_HEADER)).toBeNull();
  });
});

describe('fitReadableApps', () => {
  it('kuerzt auf das Budget, die aufgerufene App zuerst, und zeigt nie mehr', () => {
    const many = Array.from(
      { length: 400 },
      (_, i) => `app-${String(i).padStart(3, '0')}-xxxxxxxxxxxx`,
    );
    const fitted = fitReadableApps(
      [...many, 'knowledge'],
      READABLE_APPS_HEADER_BUDGET,
      'knowledge',
    );
    expect(fitted).not.toBeNull();
    expect(fitted?.[0]).toBe('knowledge');
    expect(fitted?.length).toBeLessThan(401);
    for (const name of fitted ?? []) expect([...many, 'knowledge']).toContain(name);
  });

  it('laesst eine Liste, die passt, unveraendert (nur sortiert)', () => {
    expect(fitReadableApps(['wiki', 'crm'])).toEqual(['crm', 'wiki']);
  });
});
