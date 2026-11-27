import { describe, expect, it } from 'vitest';
import {
  createToolRoute,
  decodeReadableApps,
  encodeReadableApps,
  getReadableApps,
  GROUPS_HEADER,
  ISSUED_AT_HEADER,
  READABLE_APPS_HEADER,
  READABLE_APPS_SIGNATURE_HEADER,
  readableAppsSignatureFor,
  SIGNATURE_HEADER,
  signatureFor,
  USER_EMAIL_HEADER,
  USER_ID_HEADER,
  type GetUserOptions,
} from '../src/index.js';

/**
 * Die lesbaren Apps (ADR 0020) sind ein Filter, keine Anzeige. Riskant ist
 * jeder Weg, auf dem eine Liste durchgeht, die nicht von der Plattform fuer
 * genau diese Anfrage ausgestellt wurde. Jeder dieser Wege muss `null` geben.
 */

const SECRET = 'r'.repeat(48);
const OTHER_SECRET = 'q'.repeat(48);
const APP_ID = 'knowledge';
const APP_HOST = 'apps.example.com';
const NOW_SECONDS = 1_794_387_600;
const now = () => NOW_SECONDS * 1000;
const OPTIONS: GetUserOptions = { secret: SECRET, appId: APP_ID, appHost: APP_HOST, now };

interface Build {
  apps?: readonly string[];
  value?: string;
  signature?: string;
  signingSecret?: string;
  signingAppId?: string;
  signingUserId?: string;
  signingIssuedAt?: string;
  userId?: string;
  issuedAt?: string;
}

function headers(build: Build = {}): Record<string, string> {
  const userId = build.userId ?? 'usr_1';
  const email = 'lena@example.com';
  const groups = '';
  const issuedAt = build.issuedAt ?? String(NOW_SECONDS);
  const value = build.value ?? encodeReadableApps(build.apps ?? ['wiki', 'crm']);
  return {
    host: APP_HOST,
    [USER_ID_HEADER]: userId,
    [USER_EMAIL_HEADER]: email,
    [GROUPS_HEADER]: groups,
    [ISSUED_AT_HEADER]: issuedAt,
    [SIGNATURE_HEADER]: signatureFor({
      secret: SECRET,
      appId: APP_ID,
      host: APP_HOST,
      userId,
      email,
      groups,
      issuedAt,
    }),
    [READABLE_APPS_HEADER]: value,
    [READABLE_APPS_SIGNATURE_HEADER]:
      build.signature ??
      readableAppsSignatureFor({
        secret: build.signingSecret ?? SECRET,
        appId: build.signingAppId ?? APP_ID,
        host: APP_HOST,
        userId: build.signingUserId ?? userId,
        issuedAt: build.signingIssuedAt ?? issuedAt,
        value,
      }),
  };
}

describe('getReadableApps: was null geben muss', () => {
  it('ohne Header', () => {
    const h = headers();
    delete h[READABLE_APPS_HEADER];
    delete h[READABLE_APPS_SIGNATURE_HEADER];
    expect(getReadableApps(h, OPTIONS)).toBeNull();
  });

  it('mit leeren Headern, wie die Plattform sie fuer Apps ohne Anforderung setzt', () => {
    const h = headers();
    h[READABLE_APPS_HEADER] = '';
    h[READABLE_APPS_SIGNATURE_HEADER] = '';
    expect(getReadableApps(h, OPTIONS)).toBeNull();
  });

  it('mit einer selbst gebauten Liste ohne gueltige Signatur', () => {
    expect(getReadableApps(headers({ signature: 'a'.repeat(64) }), OPTIONS)).toBeNull();
  });

  it('mit einer Signatur aus dem Secret einer anderen App', () => {
    expect(getReadableApps(headers({ signingSecret: OTHER_SECRET }), OPTIONS)).toBeNull();
  });

  it('mit einer Signatur fuer eine andere App-Id', () => {
    expect(getReadableApps(headers({ signingAppId: 'wiki' }), OPTIONS)).toBeNull();
  });

  it('mit einer Liste, die fuer eine andere Person ausgestellt war', () => {
    expect(getReadableApps(headers({ signingUserId: 'usr_admin' }), OPTIONS)).toBeNull();
  });

  it('mit einer Liste aus einer frueheren Entscheidung', () => {
    expect(
      getReadableApps(headers({ signingIssuedAt: String(NOW_SECONDS - 5) }), OPTIONS),
    ).toBeNull();
  });

  it('wenn die Identitaet abgelaufen ist, auch bei passender Listen-Signatur', () => {
    expect(getReadableApps(headers({ issuedAt: String(NOW_SECONDS - 61) }), OPTIONS)).toBeNull();
  });

  it('wenn die Identitaet selbst gefaelscht ist', () => {
    const h = headers();
    h[SIGNATURE_HEADER] = 'b'.repeat(64);
    expect(getReadableApps(h, OPTIONS)).toBeNull();
  });

  it('mit einem signierten, aber unbrauchbaren Inhalt', () => {
    const bad = Buffer.from(JSON.stringify({ v: 1, apps: ['Wiki!'] })).toString('base64url');
    expect(getReadableApps(headers({ value: bad }), OPTIONS)).toBeNull();
    const wrongVersion = Buffer.from(JSON.stringify({ v: 2, apps: [] })).toString('base64url');
    expect(getReadableApps(headers({ value: wrongVersion }), OPTIONS)).toBeNull();
  });

  it('wenn die App nicht konfiguriert ist, ohne zu werfen', () => {
    expect(getReadableApps(headers(), { appId: APP_ID, appHost: APP_HOST, now })).toBeNull();
  });
});

describe('getReadableApps: was durchgeht', () => {
  it('die signierte Liste fuer genau diese Anfrage', () => {
    expect(getReadableApps(headers({ apps: ['wiki', 'crm'] }), OPTIONS)).toEqual(['wiki', 'crm']);
  });

  it('eine leere, signierte Liste ist eine Liste, nicht null', () => {
    expect(getReadableApps(headers({ apps: [] }), OPTIONS)).toEqual([]);
  });

  it('entfernt doppelte Namen', () => {
    expect(decodeReadableApps(encodeReadableApps(['wiki', 'wiki', 'crm']))).toEqual([
      'wiki',
      'crm',
    ]);
  });
});

describe('createToolRoute reicht Aufrufer und lesbare Apps weiter', () => {
  it('ctx.readableApps ist die gepruefte Liste, ctx.caller der Mensch', async () => {
    let seen: unknown;
    const route = createToolRoute(
      {
        probe: async (_args, ctx) => {
          seen = { caller: ctx.caller, readable: ctx.readableApps };
          return null;
        },
      },
      OPTIONS,
    );
    const response = await route(
      new Request('http://knowledge.internal/api/tools/probe', {
        method: 'POST',
        headers: headers({ apps: ['wiki'] }),
        body: '{}',
      }),
      { params: { tool: 'probe' } },
    );
    expect(response.status).toBe(200);
    expect(seen).toEqual({ caller: { kind: 'human', id: 'usr_1' }, readable: ['wiki'] });
  });

  it('ctx.readableApps ist null bei gefaelschter Liste, der Aufruf laeuft trotzdem', async () => {
    let seen: unknown = 'unset';
    const route = createToolRoute(
      {
        probe: async (_args, ctx) => {
          seen = ctx.readableApps;
          return null;
        },
      },
      OPTIONS,
    );
    const response = await route(
      new Request('http://knowledge.internal/api/tools/probe', {
        method: 'POST',
        headers: headers({ signature: 'c'.repeat(64) }),
        body: '{}',
      }),
      { params: { tool: 'probe' } },
    );
    expect(response.status).toBe(200);
    expect(seen).toBeNull();
  });
});
