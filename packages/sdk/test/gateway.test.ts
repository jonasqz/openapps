import { describe, expect, it } from 'vitest';
import {
  GROUPS_HEADER,
  ISSUED_AT_HEADER,
  SdkConfigurationError,
  SIGNATURE_HEADER,
  signatureFor,
  signatureMaterial,
  UntrustedRequestError,
  USER_EMAIL_HEADER,
  USER_ID_HEADER,
  getUser,
  type GetUserOptions,
} from '../src/index.js';

const SECRET = 's'.repeat(48);
const OTHER_SECRET = 'x'.repeat(48);
const APP_ID = 'projektliste';
const APP_HOST = 'projektliste.apps.blyck.de';

/** Feste Uhr: 2026-11-09T09:00:00Z. */
const NOW_SECONDS = 1_794_387_600;
const now = () => NOW_SECONDS * 1000;

const BASE_OPTIONS: GetUserOptions = { secret: SECRET, appId: APP_ID, appHost: APP_HOST, now };

interface Claims {
  userId: string;
  email: string;
  groups: string;
  issuedAt: string;
}

function claims(overrides: Partial<Claims> = {}): Claims {
  return {
    userId: 'usr_123',
    email: 'jonas@blyck.de',
    groups: 'team,admins',
    issuedAt: String(NOW_SECONDS),
    ...overrides,
  };
}

/** Header, wie das Gateway sie setzt: alle fünf, Signatur passend gebildet. */
function signedHeaders(
  values: Claims = claims(),
  signing: { secret?: string; appId?: string; host?: string } = {},
): Record<string, string> {
  const signature = signatureFor({
    secret: signing.secret ?? SECRET,
    appId: signing.appId ?? APP_ID,
    host: signing.host ?? APP_HOST,
    ...values,
  });
  return {
    host: APP_HOST,
    [USER_ID_HEADER]: values.userId,
    [USER_EMAIL_HEADER]: values.email,
    [GROUPS_HEADER]: values.groups,
    [ISSUED_AT_HEADER]: values.issuedAt,
    [SIGNATURE_HEADER]: signature,
  };
}

describe('getUser — gültige Signatur', () => {
  it('nimmt korrekt signierte Header an', () => {
    const user = getUser(signedHeaders(), BASE_OPTIONS);
    expect(user.id).toBe('usr_123');
    expect(user.email).toBe('jonas@blyck.de');
    expect(user.groups).toEqual(['team', 'admins']);
    expect(user.issuedAt.getTime()).toBe(NOW_SECONDS * 1000);
  });

  it('nimmt einen Nutzer ohne Gruppen an (leerer Header, mitsigniert)', () => {
    const user = getUser(signedHeaders(claims({ groups: '' })), BASE_OPTIONS);
    expect(user.groups).toEqual([]);
  });

  it('nimmt eine Signatur am Rand des Fensters an', () => {
    const headers = signedHeaders(claims({ issuedAt: String(NOW_SECONDS - 60) }));
    expect(getUser(headers, BASE_OPTIONS).id).toBe('usr_123');
  });

  it('arbeitet mit Fetch-Headers', () => {
    const headers = new Headers(signedHeaders());
    expect(getUser(headers, BASE_OPTIONS).id).toBe('usr_123');
  });

  it('prüft Header-Namen unabhängig von Groß-/Kleinschreibung', () => {
    const signed = signedHeaders();
    const headers = {
      Host: APP_HOST,
      'X-Auth-User-Id': signed[USER_ID_HEADER] as string,
      'X-Auth-User-Email': signed[USER_EMAIL_HEADER] as string,
      'X-Auth-Groups': signed[GROUPS_HEADER] as string,
      'X-Auth-Issued-At': signed[ISSUED_AT_HEADER] as string,
      'X-Auth-Signature': signed[SIGNATURE_HEADER] as string,
    };
    expect(getUser(headers, BASE_OPTIONS).id).toBe('usr_123');
  });
});

describe('getUser — falsche oder fehlende Signatur', () => {
  it('weist eine fehlende Signatur ab', () => {
    const headers = signedHeaders();
    delete headers[SIGNATURE_HEADER];
    expect(() => getUser(headers, BASE_OPTIONS)).toThrowError(UntrustedRequestError);
  });

  it('weist eine leere Signatur ab', () => {
    const headers = { ...signedHeaders(), [SIGNATURE_HEADER]: '' };
    expect(() => getUser(headers, BASE_OPTIONS)).toThrowError(UntrustedRequestError);
  });

  it('weist eine Signatur ab, die kein Hex ist', () => {
    const headers = { ...signedHeaders(), [SIGNATURE_HEADER]: 'nicht-mal-hex' };
    expect(() => getUser(headers, BASE_OPTIONS)).toThrowError(UntrustedRequestError);
  });

  it('weist eine Signatur ab, die nur ein Präfix der richtigen ist', () => {
    const signed = signedHeaders();
    const headers = {
      ...signed,
      [SIGNATURE_HEADER]: (signed[SIGNATURE_HEADER] ?? '').slice(0, 32),
    };
    expect(() => getUser(headers, BASE_OPTIONS)).toThrowError(UntrustedRequestError);
  });

  it('weist eine mit einem anderen Secret gebildete Signatur ab', () => {
    const headers = signedHeaders(claims(), { secret: OTHER_SECRET });
    expect(() => getUser(headers, BASE_OPTIONS)).toThrowError(UntrustedRequestError);
  });

  it('weist eine für eine andere App gebildete Signatur ab', () => {
    const headers = signedHeaders(claims(), { appId: 'crm' });
    expect(() => getUser(headers, BASE_OPTIONS)).toThrowError(UntrustedRequestError);
  });

  it('weist eine mehrfach gesetzte Signatur ab', () => {
    const signed = signedHeaders();
    const headers: Record<string, string | string[]> = {
      ...signed,
      [SIGNATURE_HEADER]: ['abc', signed[SIGNATURE_HEADER] ?? ''],
    };
    expect(() => getUser(headers, BASE_OPTIONS)).toThrowError(UntrustedRequestError);
  });
});

describe('getUser — veränderte Nutzer-Header bei gültiger Signatur', () => {
  it('weist eine ausgetauschte Nutzer-Id ab', () => {
    const headers = { ...signedHeaders(), [USER_ID_HEADER]: 'usr_eve' };
    expect(() => getUser(headers, BASE_OPTIONS)).toThrowError(UntrustedRequestError);
  });

  it('weist eine ausgetauschte E-Mail ab', () => {
    const headers = { ...signedHeaders(), [USER_EMAIL_HEADER]: 'eve@example.com' };
    expect(() => getUser(headers, BASE_OPTIONS)).toThrowError(UntrustedRequestError);
  });

  it('weist nachträglich angehängte Gruppen ab', () => {
    const headers = { ...signedHeaders(), [GROUPS_HEADER]: 'team,admins,owners' };
    expect(() => getUser(headers, BASE_OPTIONS)).toThrowError(UntrustedRequestError);
  });

  it('weist eine verschobene Zeit bei alter Signatur ab', () => {
    const headers = { ...signedHeaders(), [ISSUED_AT_HEADER]: String(NOW_SECONDS - 1) };
    expect(() => getUser(headers, BASE_OPTIONS)).toThrowError(UntrustedRequestError);
  });

  it('weist entfernte Nutzer-Header ab', () => {
    const headers = signedHeaders();
    delete headers[USER_ID_HEADER];
    expect(() => getUser(headers, BASE_OPTIONS)).toThrowError(UntrustedRequestError);
  });

  it('weist einen leeren, aber mitsignierten Nutzer ab — kein anonymer Nutzer', () => {
    const headers = signedHeaders(claims({ userId: '' }));
    expect(() => getUser(headers, BASE_OPTIONS)).toThrowError(UntrustedRequestError);
  });

  it('weist eine leere, aber mitsignierte E-Mail ab', () => {
    const headers = signedHeaders(claims({ email: '' }));
    expect(() => getUser(headers, BASE_OPTIONS)).toThrowError(UntrustedRequestError);
  });
});

describe('getUser — Zeitfenster', () => {
  it('weist eine abgelaufene Signatur ab', () => {
    const headers = signedHeaders(claims({ issuedAt: String(NOW_SECONDS - 61) }));
    expect(() => getUser(headers, BASE_OPTIONS)).toThrowError(UntrustedRequestError);
  });

  it('laesst den Vorlauf durch, den der Default erlaubt (2 s, gegen Uhrendrift)', () => {
    // ADR 0004: 2 s Vorlauf statt 0, damit eine Gateway-Uhr, die geringfuegig
    // vorgeht, nicht jeden Aufruf abweist.
    for (const ahead of [1, 2]) {
      const headers = signedHeaders(claims({ issuedAt: String(NOW_SECONDS + ahead) }));
      expect(getUser(headers, BASE_OPTIONS).id).toBe('usr_123');
    }
  });

  it('weist eine Zeit ab, die weiter in der Zukunft liegt als der Vorlauf', () => {
    const headers = signedHeaders(claims({ issuedAt: String(NOW_SECONDS + 3) }));
    expect(() => getUser(headers, BASE_OPTIONS)).toThrowError(UntrustedRequestError);
  });

  it('nimmt den Vorlauf aus den Optionen, nicht aus dem Default', () => {
    const headers = signedHeaders(claims({ issuedAt: String(NOW_SECONDS + 4) }));
    expect(() => getUser(headers, BASE_OPTIONS)).toThrowError(UntrustedRequestError);
    expect(getUser(headers, { ...BASE_OPTIONS, futureToleranceSeconds: 5 }).id).toBe('usr_123');
    expect(() => getUser(headers, { ...BASE_OPTIONS, futureToleranceSeconds: 0 })).toThrowError(
      UntrustedRequestError,
    );
  });

  it('nimmt das Fenster aus den Optionen, nicht aus der Uhr der Maschine', () => {
    const headers = signedHeaders(claims({ issuedAt: String(NOW_SECONDS - 300) }));
    expect(() => getUser(headers, BASE_OPTIONS)).toThrowError(UntrustedRequestError);
    expect(getUser(headers, { ...BASE_OPTIONS, maxAgeSeconds: 600 }).id).toBe('usr_123');
  });

  it('weist eine Zeit ab, die keine Unix-Sekunde ist', () => {
    for (const issuedAt of ['', 'gestern', '-5', '1.5', ' 1794387600 ', '0x10']) {
      const headers = signedHeaders(claims({ issuedAt }));
      expect(() => getUser(headers, BASE_OPTIONS)).toThrowError(UntrustedRequestError);
    }
  });
});

describe('getUser — Domain', () => {
  it('weist eine für eine andere Domain gebildete Signatur ab', () => {
    const headers = signedHeaders(claims(), { host: 'crm.apps.blyck.de' });
    expect(() => getUser(headers, BASE_OPTIONS)).toThrowError(UntrustedRequestError);
  });

  it('weist einen Aufruf ab, der sich an eine andere Domain richtet', () => {
    const headers = { ...signedHeaders(), host: 'crm.apps.blyck.de' };
    expect(() => getUser(headers, BASE_OPTIONS)).toThrowError(
      /richtet sich an 'crm.apps.blyck.de'/,
    );
  });

  it('nimmt X-Forwarded-Host vor Host und ignoriert den Port', () => {
    const headers = { ...signedHeaders(), host: 'intern:3000', 'x-forwarded-host': APP_HOST };
    expect(getUser(headers, BASE_OPTIONS).id).toBe('usr_123');
  });

  it('nimmt einen Aufruf ohne Host-Header an, wenn die Signatur passt', () => {
    const headers = signedHeaders();
    delete headers['host'];
    expect(getUser(headers, BASE_OPTIONS).id).toBe('usr_123');
  });
});

describe('getUser — Konfiguration', () => {
  it('wirft ohne Secret', () => {
    expect(() => getUser(signedHeaders(), { ...BASE_OPTIONS, secret: '' })).toThrowError(
      SdkConfigurationError,
    );
  });

  it('wirft bei zu kurzem Secret', () => {
    expect(() =>
      getUser(signedHeaders(), { ...BASE_OPTIONS, secret: 'a'.repeat(31) }),
    ).toThrowError(SdkConfigurationError);
  });

  it('wirft ohne App-Id', () => {
    expect(() => getUser(signedHeaders(), { ...BASE_OPTIONS, appId: '' })).toThrowError(
      SdkConfigurationError,
    );
  });

  it('wirft ohne App-Domain', () => {
    expect(() => getUser(signedHeaders(), { ...BASE_OPTIONS, appHost: '' })).toThrowError(
      SdkConfigurationError,
    );
  });

  it('prüft die Konfiguration, bevor es die Header ansieht', () => {
    expect(() => getUser({}, { ...BASE_OPTIONS, secret: '' })).toThrowError(SdkConfigurationError);
  });
});

/**
 * Der Grund für die Längenpräfixe im Signatur-Material: Zwei verschiedene
 * Eingaben dürfen nie dasselbe Material ergeben. Bei naiver Verkettung mit
 * einem Trennzeichen täten sie es — und eine Signatur für den einen Nutzer
 * würde den anderen beweisen.
 */
describe('signatureMaterial — Feldgrenzen', () => {
  const host = APP_HOST;

  it('unterscheidet zwei Eingaben, die naiv verkettet gleich wären', () => {
    const a = signatureMaterial({
      appId: APP_ID,
      host,
      userId: 'usr_1',
      email: 'eve@example.com,team',
      groups: '',
      issuedAt: String(NOW_SECONDS),
    });
    const b = signatureMaterial({
      appId: APP_ID,
      host,
      userId: 'usr_1',
      email: 'eve@example.com',
      groups: 'team',
      issuedAt: String(NOW_SECONDS),
    });
    expect(a).not.toBe(b);
  });

  it('unterscheidet eine verschobene Grenze zwischen Nutzer-Id und E-Mail', () => {
    const a = signatureMaterial({
      appId: APP_ID,
      host,
      userId: 'usr_1x',
      email: 'y@blyck.de',
      groups: 'team',
      issuedAt: String(NOW_SECONDS),
    });
    const b = signatureMaterial({
      appId: APP_ID,
      host,
      userId: 'usr_1',
      email: 'xy@blyck.de',
      groups: 'team',
      issuedAt: String(NOW_SECONDS),
    });
    expect(a).not.toBe(b);
  });

  it('weist die verschobene Grenze auch über getUser ab', () => {
    const shifted = claims({ userId: 'usr_12', email: '3jonas@blyck.de' });
    const headers = signedHeaders(claims());
    const tampered = {
      ...headers,
      [USER_ID_HEADER]: shifted.userId,
      [USER_EMAIL_HEADER]: shifted.email,
    };
    expect(() => getUser(tampered, BASE_OPTIONS)).toThrowError(UntrustedRequestError);
  });

  it('zählt die Länge in UTF-8-Bytes, nicht in Zeichen', () => {
    const material = signatureMaterial({
      appId: APP_ID,
      host,
      userId: 'usr_1',
      email: 'jörg@blyck.de',
      groups: '',
      issuedAt: String(NOW_SECONDS),
    });
    // 'jörg@blyck.de' ist 13 Zeichen, aber 14 Bytes.
    expect(material).toContain('14:jörg@blyck.de');
  });

  it('beginnt mit der Version des Materials', () => {
    const material = signatureMaterial({
      appId: APP_ID,
      host,
      userId: 'usr_1',
      email: 'a@b.de',
      groups: '',
      issuedAt: String(NOW_SECONDS),
    });
    expect(material.startsWith('openapps-forward-auth/1\n')).toBe(true);
  });
});
