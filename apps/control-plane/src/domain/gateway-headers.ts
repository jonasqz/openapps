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
  GROUPS_HEADER,
  ISSUED_AT_HEADER,
  SIGNATURE_HEADER,
  USER_EMAIL_HEADER,
  USER_ID_HEADER,
  signatureFor,
} from '@openapps/sdk';

export { GROUPS_HEADER, ISSUED_AT_HEADER, SIGNATURE_HEADER, USER_EMAIL_HEADER, USER_ID_HEADER };

/** Alle Header, die Traefik als `authResponseHeaders` uebernehmen muss. */
export const IDENTITY_HEADERS = [
  USER_ID_HEADER,
  USER_EMAIL_HEADER,
  GROUPS_HEADER,
  ISSUED_AT_HEADER,
  SIGNATURE_HEADER,
] as const;

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
      `App "${app.name}" hat keine Domain; ohne sie kann keine Signatur gebildet werden`,
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
