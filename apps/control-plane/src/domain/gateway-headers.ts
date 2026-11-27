/**
 * Die Identitaets-Header, die die Forward-Auth zurueckgibt (Spec
 * `docs/specs/woche-1-forward-auth.md` Abschnitt 3, ADR 0004).
 *
 * ## Es gibt nur eine Implementierung, und sie liegt im SDK
 *
 * Signatur und Signatur-Material kommen aus `@openapps/sdk`
 * (`signatureFor`, `signatureMaterial`). Diese Datei baut nichts davon nach.
 * Der Grund ist nicht Bequemlichkeit: Gateway und App muessen das Material
 * **byte-gleich** bilden, sonst ist die Pruefung eine Zufallspruefung. Zwei
 * Implementierungen desselben Formats driften, und zwar leise — der Fehler
 * zeigt sich erst, wenn eine E-Mail ein Sonderzeichen hat.
 *
 * Diese Datei setzt deshalb nur zusammen: Werte einsammeln, `signatureFor`
 * rufen, die fuenf Header bilden.
 *
 * ## Die fuenf Header
 *
 *     X-Auth-User-Id      Nutzer-Id aus Better Auth
 *     X-Auth-User-Email   E-Mail
 *     X-Auth-Groups       Gruppen, mit Komma getrennt
 *     X-Auth-Issued-At    Unix-Sekunden der Entscheidung
 *     X-Auth-Signature    HMAC-SHA256, Hex, ueber App-Id, Host und die vier Werte
 *
 * Alle fuenf werden **immer** gesetzt, auch mit leeren Werten. Sonst reicht
 * Traefik einen vom Client mitgeschickten Header unveraendert durch (Spec 3.1).
 */

import { appAuthSecret } from './app-secret';
import { appIdOf, gatewayHost } from './gateway-identity';
import { ConflictError } from './errors';
import type { App } from './types';
import {
  decodeNav,
  encodeNav,
  GROUPS_HEADER,
  ISSUED_AT_HEADER,
  NAV_HEADER,
  NAV_SIGNATURE_HEADER,
  navSignatureFor,
  decodeReadableApps,
  encodeReadableApps,
  READABLE_APPS_HEADER,
  READABLE_APPS_SIGNATURE_HEADER,
  readableAppsSignatureFor,
  SIGNATURE_HEADER,
  USER_EMAIL_HEADER,
  USER_ID_HEADER,
  signatureFor,
  type PlatformNav,
} from '@openapps/sdk';

export {
  GROUPS_HEADER,
  ISSUED_AT_HEADER,
  NAV_HEADER,
  NAV_SIGNATURE_HEADER,
  READABLE_APPS_HEADER,
  READABLE_APPS_SIGNATURE_HEADER,
  SIGNATURE_HEADER,
  USER_EMAIL_HEADER,
  USER_ID_HEADER,
};

/** Die fuenf Identitaets-Header. Ihre Signatur haengt nur an ihnen. */
export const IDENTITY_HEADERS = [
  USER_ID_HEADER,
  USER_EMAIL_HEADER,
  GROUPS_HEADER,
  ISSUED_AT_HEADER,
  SIGNATURE_HEADER,
] as const;

/**
 * Die zwei Header der gemeinsamen Leiste (ADR 0017). Eigene Signatur, an
 * Nutzer-Id und Ausstellzeit der Identitaet gebunden. Anzeige, keine Freigabe.
 */
export const NAV_HEADERS = [NAV_HEADER, NAV_SIGNATURE_HEADER] as const;

/**
 * Die zwei Header der lesbaren Apps (ADR 0020). Eigene Signatur wie die
 * Navigation, aber ein Filter, keine Anzeige: Knowledge zeigt damit nur
 * Treffer aus Apps, die der Aufrufer lesen darf.
 */
export const READABLE_APPS_HEADERS = [
  READABLE_APPS_HEADER,
  READABLE_APPS_SIGNATURE_HEADER,
] as const;

/**
 * Alle Header, die die Forward-Auth bei einem Ja setzt: Identitaet,
 * Navigation und lesbare Apps. Genau diese muss Traefik als
 * `authResponseHeaders` uebernehmen und aus jeder eingehenden Anfrage
 * loeschen — sonst schmuggelt ein Browser eigene Links in die Leiste oder
 * eine eigene Liste lesbarer Apps in die Suche.
 */
export const GATEWAY_RESPONSE_HEADERS = [
  ...IDENTITY_HEADERS,
  ...NAV_HEADERS,
  ...READABLE_APPS_HEADERS,
] as const;

/** Beide Nav-Header leer: so sieht ein Ja ohne Navigation aus. */
export const EMPTY_NAV_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  [NAV_HEADER]: '',
  [NAV_SIGNATURE_HEADER]: '',
});

/**
 * Hoechstlaenge des Nav-Werts, den die Control Plane sendet. Header-Puffer
 * sind endlich (Node: 16 KiB fuer **alle** Header einer Anfrage zusammen); ein
 * zu grosser Wert koennte den Aufruf der App mit 431 scheitern lassen. Passt
 * die Liste nicht, wird sie gekuerzt, die aufgerufene App bleibt drin.
 */
export const NAV_HEADER_BUDGET = 8 * 1024;

export interface GatewayIdentity {
  readonly userId: string;
  readonly email: string;
  readonly groups: readonly string[];
  /** Unix-Sekunden. */
  readonly issuedAt: number;
}

export interface IdentityHeaderInput {
  readonly identity: GatewayIdentity;
  /** Byte-gleich mit `OPENAPPS_APP_ID` der App (siehe domain/gateway-identity). */
  readonly appId: string;
  /** Byte-gleich mit `OPENAPPS_APP_HOST` der App. */
  readonly host: string;
  /** Das abgeleitete Secret dieser App (siehe domain/app-secret). */
  readonly secret: string;
}

/**
 * Die fuenf Header fuer eine erlaubte Entscheidung.
 *
 * Die Rohwerte, die hier in die Header gehen, sind genau die, die ins
 * Signatur-Material gehen — dieselben Zeichenketten, keine zweite
 * Normalisierung. `groups` wird einmal mit Komma verbunden und dieser Wert
 * benutzt, nicht zweimal gebildet.
 */
export function identityHeaders(input: IdentityHeaderInput): Readonly<Record<string, string>> {
  const userId = input.identity.userId;
  const email = input.identity.email;
  const groups = input.identity.groups.join(',');
  const issuedAt = String(input.identity.issuedAt);

  const signature = signatureFor({
    secret: input.secret,
    appId: input.appId,
    host: input.host,
    userId,
    email,
    groups,
    issuedAt,
  });

  return {
    [USER_ID_HEADER]: userId,
    [USER_EMAIL_HEADER]: email,
    [GROUPS_HEADER]: groups,
    [ISSUED_AT_HEADER]: issuedAt,
    [SIGNATURE_HEADER]: signature,
  };
}

/**
 * Dieselben Header, aber fuer eine konkrete App — mit App-Id, Host und Secret
 * aus genau den Funktionen, die auch die Env der App fuellen
 * (`gateway-identity.ts`, `app-secret.ts`).
 *
 * Diese Funktion ist der einzige Weg, eine Signatur fuer eine App zu bilden.
 * Wer sie umgeht, bildet App-Id, Host oder Secret ein zweites Mal — und genau
 * das ist der Fehler, an dem die Pruefung im SDK scheitert.
 */
export function identityHeadersForApp(params: {
  readonly app: Pick<App, 'name' | 'primaryDomain' | 'authSecretGeneration'>;
  readonly identity: GatewayIdentity;
  readonly masterSecret: string;
}): Readonly<Record<string, string>> {
  const { app } = params;
  if (app.primaryDomain === null) {
    throw new ConflictError(
      `App "${app.name}" has no domain; without it no signature can be computed`,
    );
  }
  const appId = appIdOf(app);
  return identityHeaders({
    identity: params.identity,
    appId,
    host: gatewayHost(app.primaryDomain),
    secret: appAuthSecret({
      masterSecret: params.masterSecret,
      appId,
      generation: app.authSecretGeneration,
    }),
  });
}

/* -------------------------------------------------------------------------- */
/* Navigation (ADR 0017)                                                       */
/* -------------------------------------------------------------------------- */

export interface NavHeaderInput {
  readonly nav: PlatformNav;
  /** Dieselben Rohwerte wie in den Identitaets-Headern dieser Antwort. */
  readonly identity: Pick<GatewayIdentity, 'userId' | 'issuedAt'>;
  readonly appId: string;
  readonly host: string;
  readonly secret: string;
  /** Name der aufgerufenen App: bleibt beim Kuerzen in der Liste. */
  readonly currentApp?: string;
}

/**
 * Kuerzt die App-Liste, bis der kodierte Wert ins Budget passt. Die
 * aufgerufene App wird zuletzt entfernt — die Leiste soll wenigstens sie
 * zeigen. Passt nicht einmal die leere Liste, `null`.
 */
export function fitNav(
  nav: PlatformNav,
  budget: number = NAV_HEADER_BUDGET,
  currentApp?: string,
): PlatformNav | null {
  if (encodeNav(nav).length <= budget) return nav;
  const current = nav.apps.filter((a) => a.name === currentApp);
  const others = nav.apps.filter((a) => a.name !== currentApp);
  // Binaere Suche statt Schritt fuer Schritt: bei 200 Apps sonst 200-mal JSON.
  let low = 0;
  let high = others.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = { ...nav, apps: [...current, ...others.slice(0, mid)] };
    if (encodeNav(candidate).length <= budget) low = mid;
    else high = mid - 1;
  }
  const fitted = { ...nav, apps: [...current, ...others.slice(0, low)] };
  if (encodeNav(fitted).length <= budget) return fitted;
  const empty = { ...nav, apps: [] };
  return encodeNav(empty).length <= budget ? empty : null;
}

/**
 * Die zwei Nav-Header. Wirft nicht: Passt die Navigation nicht ins Budget
 * oder besteht sie die Formpruefung des SDK nicht, gehen beide Header leer
 * raus. Die Pruefung ist dieselbe Funktion, mit der die App liest
 * (`decodeNav`) — was hier durchgeht, nimmt die App an.
 */
export function navHeaders(input: NavHeaderInput): Readonly<Record<string, string>> {
  const fitted = fitNav(input.nav, NAV_HEADER_BUDGET, input.currentApp);
  if (fitted === null) return EMPTY_NAV_HEADERS;
  const value = encodeNav(fitted);
  if (decodeNav(value) === null) return EMPTY_NAV_HEADERS;
  return {
    [NAV_HEADER]: value,
    [NAV_SIGNATURE_HEADER]: navSignatureFor({
      secret: input.secret,
      appId: input.appId,
      host: input.host,
      userId: input.identity.userId,
      issuedAt: String(input.identity.issuedAt),
      nav: value,
    }),
  };
}

/**
 * Die Nav-Header fuer eine konkrete App, mit App-Id, Host und Secret aus genau
 * den Funktionen, die auch `identityHeadersForApp` nutzt. Ohne Navigation
 * (`nav === null`) beide leer — gesetzt sind sie immer.
 */
export function navHeadersForApp(params: {
  readonly app: Pick<App, 'name' | 'primaryDomain' | 'authSecretGeneration'>;
  readonly identity: Pick<GatewayIdentity, 'userId' | 'issuedAt'>;
  readonly masterSecret: string;
  readonly nav: PlatformNav | null;
}): Readonly<Record<string, string>> {
  const { app } = params;
  if (params.nav === null || app.primaryDomain === null) return EMPTY_NAV_HEADERS;
  const appId = appIdOf(app);
  return navHeaders({
    nav: params.nav,
    identity: params.identity,
    appId,
    host: gatewayHost(app.primaryDomain),
    secret: appAuthSecret({
      masterSecret: params.masterSecret,
      appId,
      generation: app.authSecretGeneration,
    }),
    currentApp: app.name,
  });
}

/* -------------------------------------------------------------------------- */
/* Lesbare Apps (ADR 0020)                                                     */
/* -------------------------------------------------------------------------- */

/** Beide Header leer: so sieht ein Ja ohne angeforderte Liste aus. */
export const EMPTY_READABLE_APPS_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  [READABLE_APPS_HEADER]: '',
  [READABLE_APPS_SIGNATURE_HEADER]: '',
});

/**
 * Hoechstlaenge des kodierten Werts. Zusammen mit Navigation (8 KiB) und
 * Identitaet bleibt die Anfrage unter dem Header-Puffer von Node (16 KiB).
 * Bei App-Namen bis 40 Zeichen passen gut 80 Apps.
 */
export const READABLE_APPS_HEADER_BUDGET = 4 * 1024;

/**
 * Kuerzt die Liste, bis sie ins Budget passt: erst die aufgerufene App, dann
 * alphabetisch. Kuerzen zeigt weniger, nie mehr — es bleibt Default-Deny.
 * Passt nicht einmal die leere Liste, `null`.
 */
export function fitReadableApps(
  apps: readonly string[],
  budget: number = READABLE_APPS_HEADER_BUDGET,
  currentApp?: string,
): readonly string[] | null {
  const unique = [...new Set(apps)];
  const ordered = [
    ...unique.filter((name) => name === currentApp),
    ...unique.filter((name) => name !== currentApp).sort(),
  ];
  if (encodeReadableApps(ordered).length <= budget) return ordered;
  let low = 0;
  let high = ordered.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (encodeReadableApps(ordered.slice(0, mid)).length <= budget) low = mid;
    else high = mid - 1;
  }
  const fitted = ordered.slice(0, low);
  return encodeReadableApps(fitted).length <= budget ? fitted : null;
}

export interface ReadableAppsHeaderInput {
  readonly apps: readonly string[];
  /** Dieselben Rohwerte wie in den Identitaets-Headern dieser Antwort. */
  readonly identity: Pick<GatewayIdentity, 'userId' | 'issuedAt'>;
  readonly appId: string;
  readonly host: string;
  readonly secret: string;
  readonly currentApp?: string;
}

/**
 * Die zwei Header. Wirft nicht: Passt die Liste nicht ins Budget oder besteht
 * sie die Formpruefung des SDK nicht, gehen beide leer raus — die App zeigt
 * dann nichts aus anderen Apps. Die Pruefung ist dieselbe Funktion, mit der
 * die App liest (`decodeReadableApps`).
 */
export function readableAppsHeaders(
  input: ReadableAppsHeaderInput,
): Readonly<Record<string, string>> {
  const fitted = fitReadableApps(input.apps, READABLE_APPS_HEADER_BUDGET, input.currentApp);
  if (fitted === null) return EMPTY_READABLE_APPS_HEADERS;
  if (fitted.length < new Set(input.apps).size) {
    console.warn(
      `[gateway] readable apps for ${input.appId} shortened from ${String(input.apps.length)} to ${String(fitted.length)}`,
    );
  }
  const value = encodeReadableApps(fitted);
  if (decodeReadableApps(value) === null) return EMPTY_READABLE_APPS_HEADERS;
  return {
    [READABLE_APPS_HEADER]: value,
    [READABLE_APPS_SIGNATURE_HEADER]: readableAppsSignatureFor({
      secret: input.secret,
      appId: input.appId,
      host: input.host,
      userId: input.identity.userId,
      issuedAt: String(input.identity.issuedAt),
      value,
    }),
  };
}

/**
 * Die Header fuer eine konkrete App, mit App-Id, Host und Secret aus denselben
 * Funktionen wie `identityHeadersForApp`. `apps === null` (nicht angefordert
 * oder nicht berechnet): beide leer — gesetzt sind sie immer.
 */
export function readableAppsHeadersForApp(params: {
  readonly app: Pick<App, 'name' | 'primaryDomain' | 'authSecretGeneration'>;
  readonly identity: Pick<GatewayIdentity, 'userId' | 'issuedAt'>;
  readonly masterSecret: string;
  readonly apps: readonly string[] | null;
}): Readonly<Record<string, string>> {
  const { app } = params;
  if (params.apps === null || app.primaryDomain === null) return EMPTY_READABLE_APPS_HEADERS;
  const appId = appIdOf(app);
  return readableAppsHeaders({
    apps: params.apps,
    identity: params.identity,
    appId,
    host: gatewayHost(app.primaryDomain),
    secret: appAuthSecret({
      masterSecret: params.masterSecret,
      appId,
      generation: app.authSecretGeneration,
    }),
    currentApp: app.name,
  });
}
