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
 * Die gemeinsame Leiste (ADR 0017): welche Apps die Person sehen darf, und
 * ob sie Apps anlegen darf. Die Daten kommen vom Gateway, das bei jedem Aufruf
 * ohnehin ueber die Person entscheidet. Die App enthaelt dafuer keinen
 * Rechte-Code (CLAUDE.md 3).
 *
 * ## Anzeige, keine Freigabe
 *
 * `getNavigation` wirft nie. Fehlt der Header, stimmt die Signatur nicht oder
 * ist der Inhalt unbrauchbar, kommt `null` — die Leiste zeigt dann nur die
 * eigene App. Ob jemand eine andere App oeffnen darf, entscheidet weiter die
 * Forward-Auth beim Aufruf dieser App, nicht dieser Header.
 *
 * ## Signatur
 *
 * Eigene Signatur, nicht Teil der Identitaets-Signatur (ADR 0017,
 * Alternativen): Apps mit aelterem SDK ignorieren die neuen Header, nichts muss
 * gleichzeitig ausgerollt werden. Material, je durch `\n` getrennt:
 *
 *     openapps-nav-v1
 *     <app-id>
 *     <host>
 *     <x-auth-user-id>
 *     <x-auth-issued-at>
 *     <x-auth-nav>
 *
 * Ohne Laengenpraefixe, anders als bei der Identitaet: Kein Feld kann einen
 * Zeilenumbruch enthalten. HTTP-Header-Werte duerfen es nicht, die App-Id ist
 * ein App-Name, und der Nav-Wert ist base64url. Nutzer-Id und Ausstellzeit
 * binden den Wert an genau die Entscheidung, die auch die Identitaet traegt;
 * App-Id und Host binden ihn an diese App.
 */

export const NAV_HEADER = 'X-Auth-Nav';
export const NAV_SIGNATURE_HEADER = 'X-Auth-Nav-Signature';

export const NAV_SIGNATURE_MATERIAL_VERSION = 'openapps-nav-v1';

/** Hoechstens so viele Apps in der Leiste. Mehr gilt als unbrauchbar. */
export const NAV_MAX_APPS = 200;

/**
 * Hoechstlaenge des Header-Werts in Zeichen. Header-Puffer sind endlich (Node:
 * 16 KiB fuer alle Header zusammen); ein groesserer Wert wird gar nicht erst
 * dekodiert.
 */
export const NAV_MAX_HEADER_LENGTH = 64 * 1024;

/** Laengengrenzen der einzelnen Felder, in Zeichen. */
export const NAV_LIMITS = {
  name: 64,
  title: 200,
  category: 100,
  url: 2048,
} as const;

export interface PlatformNavApp {
  /** App-Name, zugleich ihr Pfad auf der gemeinsamen Domain. */
  readonly name: string;
  /** Anzeigename. */
  readonly title: string;
  readonly category?: string | null;
  /** Absolute http- oder https-Adresse der App. */
  readonly href: string;
}

export interface PlatformNav {
  readonly v: 1;
  /** Absolute http- oder https-Adresse der Control Plane. */
  readonly platformUrl: string;
  /** Apps, die die Person lesen darf: nicht archiviert, mit Domain. */
  readonly apps: readonly PlatformNavApp[];
  readonly canCreateApps: boolean;
  readonly isAdmin: boolean;
}

export interface NavSignatureInput {
  readonly secret: string;
  readonly appId: string;
  readonly host: string;
  /** Rohwert von `X-Auth-User-Id`. */
  readonly userId: string;
  /** Rohwert von `X-Auth-Issued-At`, als Zeichenkette. */
  readonly issuedAt: string;
  /** Der Header-Wert von `X-Auth-Nav`, so wie `encodeNav` ihn liefert. */
  readonly nav: string;
}

/** Der Header-Wert: base64url (ohne Padding) von JSON. */
export function encodeNav(nav: PlatformNav): string {
  return Buffer.from(JSON.stringify(nav), 'utf8').toString('base64url');
}

/**
 * Der Header-Wert zurueck zur Navigation, mit strenger Formpruefung. `null`,
 * wenn er kein base64url ist, kein JSON, oder eine Angabe nicht passt. Prueft
 * **keine** Signatur — dafuer ist `getNavigation` da. Exportiert, damit die
 * Control Plane vor dem Senden pruefen kann, dass die App den Wert annimmt.
 */
export function decodeNav(value: string): PlatformNav | null {
  if (value.length === 0 || value.length > NAV_MAX_HEADER_LENGTH) return null;
  // Buffer dekodiert nachsichtig und ueberspringt fremde Zeichen. Hier zaehlt
  // nur, was eindeutig base64url ist.
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  return parseNav(parsed);
}

/**
 * Die Signatur: HMAC-SHA256 ueber das Material (siehe Dateikopf), Hex in
 * Kleinbuchstaben. Dieselbe Funktion fuer Control Plane und App.
 */
export function navSignatureFor(input: NavSignatureInput): string {
  return createHmac('sha256', input.secret)
    .update(navSignatureMaterial(input), 'utf8')
    .digest('hex');
}

export function navSignatureMaterial(input: Omit<NavSignatureInput, 'secret'>): string {
  return [
    NAV_SIGNATURE_MATERIAL_VERSION,
    input.appId,
    input.host,
    input.userId,
    input.issuedAt,
    input.nav,
  ].join('\n');
}

/**
 * Liest die Navigation aus den Gateway-Headern. Dieselben Eingaben wie
 * `getUser`, dieselbe Konfiguration (Secret, App-Id, App-Domain aus der Env).
 *
 * `null`, wenn die Identitaet nicht stimmt (dann stimmt auch nichts, was an
 * ihr haengt), wenn `X-Auth-Nav` fehlt oder leer ist, wenn die Signatur nicht
 * passt, oder wenn der Inhalt die Formpruefung nicht besteht. Wirft nie: Die
 * Leiste ist Anzeige, ein Fehler hier darf keine Seite kosten.
 */
export function getNavigation(
  headers: HeaderBag,
  options: GetUserOptions = {},
): PlatformNav | null {
  try {
    // Erst die Identitaet, mit allen Pruefungen inklusive Zeitfenster. Danach
    // sind Nutzer-Id und Ausstellzeit byte-genau die signierten Rohwerte.
    getUser(headers, options);
    const config = resolveConfig(options);

    const value = readHeader(headers, NAV_HEADER);
    const presented = readHeader(headers, NAV_SIGNATURE_HEADER);
    if (value === undefined || presented === undefined) return null;

    const expected = navSignatureFor({
      secret: config.secret,
      appId: config.appId,
      host: config.appHost,
      userId: readRawHeader(headers, USER_ID_HEADER) ?? '',
      issuedAt: readRawHeader(headers, ISSUED_AT_HEADER) ?? '',
      nav: value,
    });
    if (!signatureEquals(presented, expected)) return null;

    return decodeNav(value);
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Formpruefung                                                                */
/* -------------------------------------------------------------------------- */

/** Wie App-Namen der Control Plane, mit etwas Luft nach oben. */
const NAV_APP_NAME = /^[a-z][a-z0-9-]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  if (value.length === 0 || value.length > max) return null;
  return value;
}

/**
 * Eine absolute http- oder https-Adresse, sonst `null`. Alles andere —
 * `javascript:`, `data:`, relative Pfade, Zugangsdaten in der URL — landete
 * sonst als Link in der Leiste.
 */
function safeHref(value: unknown): string | null {
  const raw = boundedString(value, NAV_LIMITS.url);
  if (raw === null) return null;
  // Steuerzeichen und Leerraum: Browser schneiden sie teils still heraus, und
  // `java\tscript:` waere dann wieder `javascript:`.
  if (/[\u0000- \u007f]/.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!/^https?:\/\//i.test(raw)) return null;
  if (url.username !== '' || url.password !== '') return null;
  return raw;
}

/**
 * Bekannte Felder werden streng geprueft und kopiert, unbekannte fallen weg.
 * So bleibt eine spaetere Erweiterung des Formats fuer aeltere SDKs lesbar,
 * und nichts Ungepruefte geht an die Leiste.
 */
function parseNav(value: unknown): PlatformNav | null {
  if (!isRecord(value)) return null;
  if (value.v !== 1) return null;
  const platformUrl = safeHref(value.platformUrl);
  if (platformUrl === null) return null;
  if (typeof value.canCreateApps !== 'boolean' || typeof value.isAdmin !== 'boolean') return null;
  if (!Array.isArray(value.apps) || value.apps.length > NAV_MAX_APPS) return null;

  const apps: PlatformNavApp[] = [];
  for (const entry of value.apps as unknown[]) {
    if (!isRecord(entry)) return null;
    const name = boundedString(entry.name, NAV_LIMITS.name);
    if (name === null || !NAV_APP_NAME.test(name)) return null;
    const title = boundedString(entry.title, NAV_LIMITS.title);
    if (title === null) return null;
    let category: string | null = null;
    if (entry.category !== undefined && entry.category !== null) {
      category = boundedString(entry.category, NAV_LIMITS.category);
      if (category === null) return null;
    }
    const href = safeHref(entry.href);
    if (href === null) return null;
    apps.push(Object.freeze({ name, title, category, href }));
  }

  return Object.freeze({
    v: 1,
    platformUrl,
    apps: Object.freeze(apps),
    canCreateApps: value.canCreateApps,
    isAdmin: value.isAdmin,
  });
}
