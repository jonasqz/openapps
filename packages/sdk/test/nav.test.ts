import { describe, expect, it } from 'vitest';
import {
  decodeNav,
  encodeNav,
  getNavigation,
  GROUPS_HEADER,
  ISSUED_AT_HEADER,
  NAV_HEADER,
  NAV_MAX_APPS,
  NAV_SIGNATURE_HEADER,
  navSignatureFor,
  SIGNATURE_HEADER,
  signatureFor,
  USER_EMAIL_HEADER,
  USER_ID_HEADER,
  type GetUserOptions,
  type PlatformNav,
} from '../src/index.js';

/**
 * Die Navigation der gemeinsamen Leiste (ADR 0017). Riskant ist, dass ein
 * Browser oder eine fremde App eigene Links in die Leiste bringt. Geprueft
 * wird deshalb zuerst, was `null` liefern muss.
 */

const SECRET = 's'.repeat(48);
const OTHER_SECRET = 'x'.repeat(48);
const APP_ID = 'crm';
const APP_HOST = 'apps.example.com';

const NOW_SECONDS = 1_794_387_600;
const now = () => NOW_SECONDS * 1000;

const OPTIONS: GetUserOptions = { secret: SECRET, appId: APP_ID, appHost: APP_HOST, now };

const NAV: PlatformNav = {
  v: 1,
  platformUrl: 'https://admin.example.com',
  apps: [
    { name: 'crm', title: 'CRM', category: 'Sales', href: 'https://apps.example.com/crm' },
    { name: 'tasks', title: 'Tasks', category: null, href: 'https://apps.example.com/tasks' },
  ],
  canCreateApps: true,
  isAdmin: false,
};

interface Signing {
  secret?: string;
  appId?: string;
  host?: string;
  userId?: string;
  issuedAt?: string;
}

/** Alle sieben Header, wie das Gateway sie setzt. */
function gatewayHeaders(
  options: { nav?: string; signing?: Signing; userId?: string; issuedAt?: string } = {},
): Record<string, string> {
  const userId = options.userId ?? 'usr_123';
  const email = 'jonas@example.com';
  const groups = 'team';
  const issuedAt = options.issuedAt ?? String(NOW_SECONDS);
  const nav = options.nav ?? encodeNav(NAV);
  const signing = options.signing ?? {};
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
    [NAV_HEADER]: nav,
    [NAV_SIGNATURE_HEADER]: navSignatureFor({
      secret: signing.secret ?? SECRET,
      appId: signing.appId ?? APP_ID,
      host: signing.host ?? APP_HOST,
      userId: signing.userId ?? userId,
      issuedAt: signing.issuedAt ?? issuedAt,
      nav,
    }),
  };
}

/** Ein Nav-Wert mit beliebigem JSON, korrekt signiert. */
function signedRaw(value: unknown): Record<string, string> {
  return gatewayHeaders({
    nav: Buffer.from(JSON.stringify(value), 'utf8').toString('base64url'),
  });
}

describe('getNavigation — was null liefern muss', () => {
  it('liefert null ohne Header', () => {
    const headers = gatewayHeaders();
    delete headers[NAV_HEADER];
    expect(getNavigation(headers, OPTIONS)).toBeNull();
  });

  it('liefert null bei leerem Header, wie das Gateway ihn ohne Navigation setzt', () => {
    const headers = gatewayHeaders();
    headers[NAV_HEADER] = '';
    headers[NAV_SIGNATURE_HEADER] = '';
    expect(getNavigation(headers, OPTIONS)).toBeNull();
  });

  it('liefert null ohne Signatur', () => {
    const headers = gatewayHeaders();
    delete headers[NAV_SIGNATURE_HEADER];
    expect(getNavigation(headers, OPTIONS)).toBeNull();
  });

  it('liefert null bei veraendertem Wert', () => {
    const headers = gatewayHeaders();
    const forged: PlatformNav = {
      ...NAV,
      apps: [...NAV.apps, { name: 'evil', title: 'Evil', href: 'https://evil.example' }],
    };
    headers[NAV_HEADER] = encodeNav(forged);
    expect(getNavigation(headers, OPTIONS)).toBeNull();
  });

  it('liefert null, wenn die Signatur fuer eine andere App gebildet wurde', () => {
    expect(getNavigation(gatewayHeaders({ signing: { appId: 'tasks' } }), OPTIONS)).toBeNull();
    expect(
      getNavigation(gatewayHeaders({ signing: { host: 'other.example.com' } }), OPTIONS),
    ).toBeNull();
    expect(
      getNavigation(gatewayHeaders({ signing: { secret: OTHER_SECRET } }), OPTIONS),
    ).toBeNull();
  });

  it('liefert null, wenn Nutzer oder Ausstellzeit nicht die der Identitaet sind', () => {
    expect(getNavigation(gatewayHeaders({ signing: { userId: 'usr_other' } }), OPTIONS)).toBeNull();
    expect(
      getNavigation(gatewayHeaders({ signing: { issuedAt: String(NOW_SECONDS - 1) } }), OPTIONS),
    ).toBeNull();
  });

  it('liefert null, wenn die Identitaet nicht stimmt', () => {
    const headers = gatewayHeaders();
    headers[SIGNATURE_HEADER] = 'f'.repeat(64);
    expect(getNavigation(headers, OPTIONS)).toBeNull();

    // Abgelaufen: dieselbe Navigation, aber die Entscheidung ist zu alt.
    const old = gatewayHeaders({ issuedAt: String(NOW_SECONDS - 3600) });
    expect(getNavigation(old, OPTIONS)).toBeNull();
  });

  it('wirft nie, auch ohne Konfiguration', () => {
    expect(
      getNavigation(gatewayHeaders(), { secret: '', appId: APP_ID, appHost: APP_HOST, now }),
    ).toBeNull();
    expect(getNavigation({}, OPTIONS)).toBeNull();
  });

  it('weist javascript:-Links und andere Schemata ab', () => {
    for (const href of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      ' javascript:alert(1)',
      'java\tscript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      '//evil.example/crm',
      '/crm',
      'https://user:pass@apps.example.com/crm',
    ]) {
      const value = { ...NAV, apps: [{ name: 'crm', title: 'CRM', href }] };
      expect(getNavigation(signedRaw(value), OPTIONS), href).toBeNull();
    }
    expect(
      getNavigation(signedRaw({ ...NAV, platformUrl: 'javascript:alert(1)' }), OPTIONS),
    ).toBeNull();
  });

  it('weist kaputtes JSON und falsche Formen ab', () => {
    const malformed = gatewayHeaders({ nav: Buffer.from('{nope', 'utf8').toString('base64url') });
    expect(getNavigation(malformed, OPTIONS)).toBeNull();
    expect(getNavigation(gatewayHeaders({ nav: 'not+base64/=' }), OPTIONS)).toBeNull();

    for (const value of [
      null,
      [],
      { ...NAV, v: 2 },
      { ...NAV, v: '1' },
      { ...NAV, canCreateApps: 'yes' },
      { ...NAV, isAdmin: undefined },
      { ...NAV, apps: 'crm' },
      { ...NAV, apps: [{ name: 'crm', title: '', href: 'https://a.example/crm' }] },
      { ...NAV, apps: [{ name: 'CRM!', title: 'CRM', href: 'https://a.example/crm' }] },
      { ...NAV, apps: [{ name: 'crm', title: 'x'.repeat(201), href: 'https://a.example/crm' }] },
      { ...NAV, apps: [{ name: 'crm', title: 'CRM', category: 7, href: 'https://a.example/crm' }] },
      {
        ...NAV,
        apps: Array.from({ length: NAV_MAX_APPS + 1 }, (_, i) => ({
          name: `app-${String(i)}`,
          title: 'A',
          href: `https://a.example/app-${String(i)}`,
        })),
      },
    ]) {
      expect(
        getNavigation(signedRaw(value), OPTIONS),
        JSON.stringify(value)?.slice(0, 60),
      ).toBeNull();
    }
  });
});

describe('getNavigation — gueltige Navigation', () => {
  it('liest eine korrekt signierte Navigation', () => {
    const nav = getNavigation(gatewayHeaders(), OPTIONS);
    expect(nav).toEqual(NAV);
  });

  it('liest mit Fetch-Headers genauso', () => {
    const nav = getNavigation(new Headers(gatewayHeaders()), OPTIONS);
    expect(nav?.apps.map((a) => a.name)).toEqual(['crm', 'tasks']);
  });

  it('setzt eine fehlende Kategorie auf null und laesst unbekannte Felder weg', () => {
    const nav = getNavigation(
      signedRaw({
        ...NAV,
        extra: 'x',
        apps: [{ name: 'crm', title: 'CRM', href: 'http://127.0.0.1:8090/crm', extra: 1 }],
      }),
      OPTIONS,
    );
    expect(nav?.apps).toEqual([
      { name: 'crm', title: 'CRM', category: null, href: 'http://127.0.0.1:8090/crm' },
    ]);
    expect(nav).not.toHaveProperty('extra');
  });

  it('kodiert und dekodiert verlustfrei, auch mit Umlauten', () => {
    const nav: PlatformNav = { ...NAV, apps: [{ ...NAV.apps[0]!, title: 'Kündigungen' }] };
    expect(decodeNav(encodeNav(nav))).toEqual(nav);
    expect(encodeNav(nav)).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
