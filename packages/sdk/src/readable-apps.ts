import { createHmac } from 'node:crypto';
import {
  getUser,
  ISSUED_AT_HEADER,
  resolveConfig,
  signatureEquals,
  USER_ID_HEADER,
  type GetUserOptions,
} from './gateway.js';
import { readHeader, readRawHeader, type HeaderBag } from './headers.js';

/**
 * Die Apps, die der Aufrufer lesen darf (ADR 0020), als signierter Kontext
 * der Plattform. Knowledge filtert damit Treffer aus Apps, die der Aufrufer
 * nicht sehen darf, ohne selbst Rechte zu pruefen (CLAUDE.md 3).
 *
 * ## Anders als die Navigation
 *
 * Die Navigation (ADR 0017) ist Anzeige und wird gekuerzt. Diese Liste ist
 * ein Filter: Sie entscheidet, was eine App zeigen darf. Deshalb eigene
 * Header und eigene Signatur, und deshalb heisst `null` nicht „keine Leiste“,
 * sondern „nichts aus anderen Apps zeigen“ (Default-Deny).
 *
 * ## Signatur
 *
 * Material, je durch `\n` getrennt:
 *
 *     openapps-readable-apps-v1
 *     <app-id>
 *     <host>
 *     <x-auth-user-id>
 *     <x-auth-issued-at>
 *     <x-auth-readable-apps>
 *
 * Kein Feld kann einen Zeilenumbruch enthalten (Header-Werte duerfen es nicht,
 * der Wert ist base64url). Nutzer-Id und Ausstellzeit binden die Liste an die
 * Entscheidung, die auch die Identitaet traegt; App-Id und Host an diese App.
 *
 * Die Header kommen nur, wenn das Manifest der App sie mit
 * `gatewayContext: ["readableApps"]` anfordert. Sonst sind sie leer.
 */

export const READABLE_APPS_HEADER = 'X-Auth-Readable-Apps';
export const READABLE_APPS_SIGNATURE_HEADER = 'X-Auth-Readable-Apps-Signature';

export const READABLE_APPS_SIGNATURE_MATERIAL_VERSION = 'openapps-readable-apps-v1';

/** Hoechstens so viele Apps. Mehr gilt als unbrauchbar. */
export const READABLE_APPS_MAX = 1000;

/** Hoechstlaenge des Header-Werts in Zeichen; groessere Werte werden nicht dekodiert. */
export const READABLE_APPS_MAX_HEADER_LENGTH = 64 * 1024;

/** Wie App-Namen der Control Plane, mit etwas Luft nach oben. */
const APP_NAME = /^[a-z][a-z0-9-]{0,63}$/;

export interface ReadableAppsSignatureInput {
  readonly secret: string;
  readonly appId: string;
  readonly host: string;
  /** Rohwert von `X-Auth-User-Id`. */
  readonly userId: string;
  /** Rohwert von `X-Auth-Issued-At`, als Zeichenkette. */
  readonly issuedAt: string;
  /** Der Header-Wert, so wie `encodeReadableApps` ihn liefert. */
  readonly value: string;
}

/** Der Header-Wert: base64url (ohne Padding) von `{"v":1,"apps":[...]}`. */
export function encodeReadableApps(apps: readonly string[]): string {
  return Buffer.from(JSON.stringify({ v: 1, apps }), 'utf8').toString('base64url');
}

/**
 * Der Header-Wert zurueck zur Liste, mit strenger Formpruefung. `null`, wenn
 * er kein base64url ist, kein JSON, oder ein Eintrag kein App-Name ist. Prueft
 * **keine** Signatur — dafuer ist `getReadableApps` da. Doppelte Namen fallen
 * weg, die Reihenfolge bleibt.
 */
export function decodeReadableApps(value: string): readonly string[] | null {
  if (value.length === 0 || value.length > READABLE_APPS_MAX_HEADER_LENGTH) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (record.v !== 1 || !Array.isArray(record.apps)) return null;
  if (record.apps.length > READABLE_APPS_MAX) return null;
  const seen = new Set<string>();
  const apps: string[] = [];
  for (const entry of record.apps as unknown[]) {
    if (typeof entry !== 'string' || !APP_NAME.test(entry)) return null;
    if (seen.has(entry)) continue;
    seen.add(entry);
    apps.push(entry);
  }
  return Object.freeze(apps);
}

export function readableAppsSignatureMaterial(
  input: Omit<ReadableAppsSignatureInput, 'secret'>,
): string {
  return [
    READABLE_APPS_SIGNATURE_MATERIAL_VERSION,
    input.appId,
    input.host,
    input.userId,
    input.issuedAt,
    input.value,
  ].join('\n');
}

/** HMAC-SHA256 ueber das Material, Hex in Kleinbuchstaben. Fuer Control Plane und App. */
export function readableAppsSignatureFor(input: ReadableAppsSignatureInput): string {
  return createHmac('sha256', input.secret)
    .update(readableAppsSignatureMaterial(input), 'utf8')
    .digest('hex');
}

/**
 * Die Apps, die der Aufrufer dieser Anfrage lesen darf, oder `null`.
 *
 * `null`, wenn die Identitaet nicht stimmt (Signatur, Zeitfenster, Host),
 * wenn ein Header fehlt oder leer ist, wenn die Signatur nicht passt oder der
 * Inhalt die Formpruefung nicht besteht. Wirft nie. Wer `null` bekommt, zeigt
 * nichts, was einer anderen App gehoert — und antwortet trotzdem normal.
 */
export function getReadableApps(
  headers: HeaderBag,
  options: GetUserOptions = {},
): readonly string[] | null {
  try {
    // Erst die Identitaet mit allen Pruefungen. Danach sind Nutzer-Id und
    // Ausstellzeit die signierten Rohwerte.
    getUser(headers, options);
    const config = resolveConfig(options);

    const value = readHeader(headers, READABLE_APPS_HEADER);
    const presented = readHeader(headers, READABLE_APPS_SIGNATURE_HEADER);
    if (value === undefined || presented === undefined) return null;

    const expected = readableAppsSignatureFor({
      secret: config.secret,
      appId: config.appId,
      host: config.appHost,
      userId: readRawHeader(headers, USER_ID_HEADER) ?? '',
      issuedAt: readRawHeader(headers, ISSUED_AT_HEADER) ?? '',
      value,
    });
    if (!signatureEquals(presented, expected)) return null;

    return decodeReadableApps(value);
  } catch {
    return null;
  }
}
