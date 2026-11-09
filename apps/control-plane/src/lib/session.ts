/**
 * Wer ruft? Zwei Wege fuehren hierher: ein Mensch mit Better-Auth-Session und
 * ein Agent mit OAuth-Client. Beide werden zu demselben `Actor`, weil das
 * Rechtemodell keinen Unterschied kennt.
 *
 * ## Offen (Annahme)
 *
 * Better Auth ist als Abhaengigkeit deklariert, aber noch nicht verdrahtet:
 * `resolveSession` ist ein Anschluss, keine Implementierung. Sobald die
 * Better-Auth-Instanz steht, wird `createBetterAuthSessionReader` ihr
 * `api.getSession` aufrufen — die Gruppen kommen aus dem Google-SSO-Claim.
 * Bis dahin liefert `denyAllSessions` konsequent "kein Nutzer", damit nichts
 * versehentlich offen ist (Default-Deny).
 */

import type { Actor } from '../domain/types';

export interface SessionUser {
  readonly userId: string;
  readonly email: string;
  readonly groups: readonly string[];
}

export interface SessionReader {
  /** Liest die Session aus den Cookies des Aufrufs. `null` = nicht angemeldet. */
  read(request: Request): Promise<SessionUser | null>;
}

/** Default-Deny als Implementierung: ohne verdrahtetes Better Auth kommt niemand rein. */
export const denyAllSessions: SessionReader = {
  async read() {
    return null;
  },
};

export function actorFromSession(user: SessionUser): Actor {
  return { kind: 'user', id: user.userId, groups: user.groups };
}

export function actorFromAgentName(name: string): Actor {
  return { kind: 'agent', id: name };
}
