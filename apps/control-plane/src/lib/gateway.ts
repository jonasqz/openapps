/**
 * Das Signal, mit dem eine App erkennt, dass ein Aufruf durch das Gateway kam.
 *
 * ## Annahme (vom CoS zu bestaetigen)
 *
 * Header allein genuegen nicht: wer eine App-Domain direkt erreicht, koennte
 * `X-Auth-User-Id` selbst setzen. Deshalb bekommt jede Antwort der
 * Forward-Auth eine Signatur:
 *
 *   X-Auth-User-Id        : Nutzer-Id aus Better Auth
 *   X-Auth-User-Email     : E-Mail
 *   X-Auth-Groups         : Gruppen, mit Komma getrennt
 *   X-Auth-Issued-At      : Unix-Sekunden
 *   X-Openapps-Gateway    : v1=<hex>   (HMAC-SHA256)
 *
 * Signiert wird `userId\nemail\ngroups\nissuedAt` mit `GATEWAY_SIGNING_SECRET`.
 * `@openapps/sdk` prueft die Signatur mit demselben Secret und lehnt alles ohne
 * gueltige Signatur oder aelter als `GATEWAY_SIGNATURE_MAX_AGE_S` ab.
 *
 * Damit ist die Annahme, die `@openapps/sdk` erfuellen muss, genau eine:
 * dasselbe Secret, dasselbe Trennzeichen, derselbe Header-Name. Die Funktionen
 * unten sind die Referenz; wenn das SDK etwas anderes macht, ist diese Datei
 * die Quelle der Wahrheit und wird dort nachgezogen.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export const GATEWAY_HEADER = 'x-openapps-gateway';
export const USER_ID_HEADER = 'x-auth-user-id';
export const USER_EMAIL_HEADER = 'x-auth-user-email';
export const GROUPS_HEADER = 'x-auth-groups';
export const ISSUED_AT_HEADER = 'x-auth-issued-at';

export interface GatewayIdentity {
  readonly userId: string;
  readonly email: string;
  readonly groups: readonly string[];
  readonly issuedAt: number;
}

export function signingPayload(identity: GatewayIdentity): string {
  return [
    identity.userId,
    identity.email,
    identity.groups.join(','),
    String(identity.issuedAt),
  ].join('\n');
}

export function signIdentity(identity: GatewayIdentity, secret: string): string {
  return `v1=${createHmac('sha256', secret).update(signingPayload(identity)).digest('hex')}`;
}

/** Die Header, die Traefik als `authResponseHeaders` weitergibt. */
export function identityHeaders(
  identity: GatewayIdentity,
  secret: string,
): Readonly<Record<string, string>> {
  return {
    [USER_ID_HEADER]: identity.userId,
    [USER_EMAIL_HEADER]: identity.email,
    [GROUPS_HEADER]: identity.groups.join(','),
    [ISSUED_AT_HEADER]: String(identity.issuedAt),
    [GATEWAY_HEADER]: signIdentity(identity, secret),
  };
}

/**
 * Die Gegenprobe. Steht hier, damit Control Plane und SDK dieselbe
 * Implementierung als Vorlage haben.
 */
export function verifyIdentity(
  identity: GatewayIdentity,
  signature: string,
  secret: string,
  maxAgeSeconds: number,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  const expected = Buffer.from(signIdentity(identity, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length) return false;
  if (!timingSafeEqual(expected, given)) return false;
  const age = nowSeconds - identity.issuedAt;
  return age >= -30 && age <= maxAgeSeconds;
}
