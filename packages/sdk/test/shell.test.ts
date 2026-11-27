import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APP_BASE_PATH_ENV,
  APP_HOST_ENV,
  APP_ID_ENV,
  appBasePath,
  AUTH_SECRET_ENV,
  encodeNav,
  GROUPS_HEADER,
  ISSUED_AT_HEADER,
  NAV_HEADER,
  NAV_SIGNATURE_HEADER,
  navSignatureFor,
  readShell,
  SIGNATURE_HEADER,
  signatureFor,
  USER_EMAIL_HEADER,
  USER_ID_HEADER,
  type PlatformNav,
  type ReadShellOptions,
} from '../src/index.js';

/**
 * Die Daten der gemeinsamen Leiste (ADR 0017, ADR 0019). Riskant ist, dass
 * die Leiste einer ungeprueften Anfrage Nutzer oder Links zeigt, oder dass
 * ein Fehler hier die ganze Seite kostet. Deshalb zuerst: was `null` liefern
 * muss, und dass nichts wirft.
 */

const SECRET = 's'.repeat(48);
const OTHER_SECRET = 'x'.repeat(48);
const APP_ID = 'crm';
const APP_HOST = 'apps.example.com';
const NOW_SECONDS = 1_794_387_600;

const OPTIONS: ReadShellOptions = {
  secret: SECRET,
  appId: APP_ID,
  appHost: APP_HOST,
  now: () => NOW_SECONDS * 1000,
  basePath: '/crm',
};

const APP = { name: 'crm', displayName: 'CRM' };

const NAV: PlatformNav = {
  v: 1,
  platformUrl: 'https://admin.example.com',
  apps: [
    { name: 'crm', title: 'CRM', category: 'Sales', href: 'https://apps.example.com/crm' },
    { name: 'tasks', title: 'Tasks', href: 'https://apps.example.com/tasks' },
  ],
  canCreateApps: true,
  isAdmin: false,
};

/** Alle sieben Header, wie das Gateway sie setzt, signiert mit `secret`. */
function gatewayHeaders(secret = SECRET, nav = encodeNav(NAV)): Record<string, string> {
  const userId = 'usr_123';
  const email = 'jonas@example.com';
  const groups = 'team,admins';
  const issuedAt = String(NOW_SECONDS);
  return {
    host: APP_HOST,
    [USER_ID_HEADER]: userId,
    [USER_EMAIL_HEADER]: email,
    [GROUPS_HEADER]: groups,
    [ISSUED_AT_HEADER]: issuedAt,
    [SIGNATURE_HEADER]: signatureFor({
      secret,
      appId: APP_ID,
      host: APP_HOST,
      userId,
      email,
      groups,
      issuedAt,
    }),
    [NAV_HEADER]: nav,
    [NAV_SIGNATURE_HEADER]: navSignatureFor({
      secret,
      appId: APP_ID,
      host: APP_HOST,
      userId,
      issuedAt,
      nav,
    }),
  };
}

describe('readShell — ohne gueltige Signatur nur die eigene App, nie ein Fehler', () => {
  it('liefert ohne Header weder Nutzer noch Plattform', () => {
    expect(readShell({}, APP, OPTIONS)).toEqual({
      appName: 'crm',
      appTitle: 'CRM',
      platform: null,
      user: null,
      basePath: '/crm',
    });
  });

  it('zeigt bei fremdem Secret weder Nutzer noch fremde Links', () => {
    const shell = readShell(gatewayHeaders(OTHER_SECRET), APP, OPTIONS);
    expect(shell.user).toBeNull();
    expect(shell.platform).toBeNull();
  });

  it('zeigt bei gefaelschter Navigation nur die eigene App, den Nutzer aber weiter', () => {
    const headers = gatewayHeaders();
    headers[NAV_HEADER] = encodeNav({
      ...NAV,
      apps: [...NAV.apps, { name: 'evil', title: 'Evil', href: 'https://evil.example' }],
    });
    const shell = readShell(headers, APP, OPTIONS);
    expect(shell.platform).toBeNull();
    expect(shell.user?.id).toBe('usr_123');
  });

  it('wirft nie, auch ohne Secret, App-Id und App-Domain in der Env', () => {
    const shell = readShell(gatewayHeaders(), APP, { basePath: '' });
    expect(shell.user).toBeNull();
    expect(shell.platform).toBeNull();
  });

  it('zeigt bei abgelaufener Ausstellzeit nichts von der Person', () => {
    const late = { ...OPTIONS, now: () => (NOW_SECONDS + 3600) * 1000 };
    const shell = readShell(gatewayHeaders(), APP, late);
    expect(shell.user).toBeNull();
    expect(shell.platform).toBeNull();
  });
});

describe('readShell — gueltige Anfrage', () => {
  it('liefert Nutzer und Plattform in der Form der Leiste', () => {
    expect(readShell(gatewayHeaders(), APP, OPTIONS)).toEqual({
      appName: 'crm',
      appTitle: 'CRM',
      basePath: '/crm',
      user: { id: 'usr_123', email: 'jonas@example.com', groups: ['team', 'admins'] },
      platform: {
        platformUrl: 'https://admin.example.com',
        apps: [
          { name: 'crm', title: 'CRM', category: 'Sales', href: 'https://apps.example.com/crm' },
          { name: 'tasks', title: 'Tasks', category: null, href: 'https://apps.example.com/tasks' },
        ],
        canCreateApps: true,
        isAdmin: false,
      },
    });
  });

  it('liefert nur einfache, veraenderbare Werte (geht an eine Client-Komponente)', () => {
    const shell = readShell(gatewayHeaders(), APP, OPTIONS);
    expect(Object.isFrozen(shell.platform?.apps)).toBe(false);
    expect(JSON.parse(JSON.stringify(shell))).toEqual(shell);
  });

  it('liest mit Fetch-Headers genauso', () => {
    const shell = readShell(new Headers(gatewayHeaders()), APP, OPTIONS);
    expect(shell.user?.email).toBe('jonas@example.com');
    expect(shell.platform?.apps).toHaveLength(2);
  });
});

describe('appBasePath', () => {
  it('nimmt einen gueltigen Pfad und schneidet den Schraegstrich am Ende ab', () => {
    expect(appBasePath('/crm')).toBe('/crm');
    expect(appBasePath(' /crm/ ')).toBe('/crm');
    expect(appBasePath('/leave-requests')).toBe('/leave-requests');
  });

  it('faellt bei leerem oder unbrauchbarem Wert auf "" zurueck, statt zu werfen', () => {
    for (const value of [undefined, '', '/', 'crm', '/CRM', '/crm/sub', '//evil.example', '/-x']) {
      expect(appBasePath(value)).toBe('');
    }
  });
});

describe('readShell und loadShell aus der Env', () => {
  const saved: Record<string, string | undefined> = {};
  const keys = [AUTH_SECRET_ENV, APP_ID_ENV, APP_HOST_ENV, APP_BASE_PATH_ENV];

  beforeEach(() => {
    for (const key of keys) saved[key] = process.env[key];
    process.env[AUTH_SECRET_ENV] = SECRET;
    process.env[APP_ID_ENV] = APP_ID;
    process.env[APP_HOST_ENV] = APP_HOST;
    process.env[APP_BASE_PATH_ENV] = '/crm/';
    vi.useFakeTimers();
    vi.setSystemTime(NOW_SECONDS * 1000);
  });

  afterEach(() => {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    vi.useRealTimers();
    vi.doUnmock('next/headers');
    vi.resetModules();
  });

  it('liest Secret, App-Id, Domain und basePath aus der Env', () => {
    const shell = readShell(gatewayHeaders(), APP);
    expect(shell.basePath).toBe('/crm');
    expect(shell.user?.id).toBe('usr_123');
    expect(shell.platform?.canCreateApps).toBe(true);
  });

  it('loadShell liest die Header der laufenden Anfrage', async () => {
    vi.doMock('next/headers', () => ({
      headers: async () => new Headers(gatewayHeaders()),
    }));
    const { loadShell } = await import('../src/next.js');
    const shell = await loadShell(APP);
    expect(shell.user?.email).toBe('jonas@example.com');
    expect(shell.platform?.apps.map((app) => app.name)).toEqual(['crm', 'tasks']);
    expect(shell.basePath).toBe('/crm');
  });

  it('loadShell zeigt bei gefaelschter Anfrage nur die eigene App, ohne zu werfen', async () => {
    vi.doMock('next/headers', () => ({
      headers: async () => new Headers(gatewayHeaders(OTHER_SECRET)),
    }));
    const { loadShell } = await import('../src/next.js');
    const shell = await loadShell(APP);
    expect(shell.user).toBeNull();
    expect(shell.platform).toBeNull();
  });

  it('loadShell reicht den Fehler aus headers() durch (Next erkennt so dynamisches Rendern)', async () => {
    const dynamic = new Error('Dynamic server usage: headers');
    vi.doMock('next/headers', () => ({
      headers: async () => {
        throw dynamic;
      },
    }));
    const { loadShell } = await import('../src/next.js');
    await expect(loadShell(APP)).rejects.toBe(dynamic);
  });
});
