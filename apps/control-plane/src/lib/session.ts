/**
 * Wer ruft? Zwei Wege fuehren hierher: ein Mensch mit Better-Auth-Session und
 * ein Agent mit OAuth-Client. Beide werden zu demselben `Actor`, weil das
 * Rechtemodell keinen Unterschied kennt.
 *
 * ## Woher die Gruppen kommen
 *
 * Aus der Datenbank der Control Plane (`group_members`, Migration 0009), nicht
 * aus dem Token. Ein frueherer Kommentar an dieser Stelle behauptete das
 * Gegenteil ("aus dem Google-SSO-Claim") — das war falsch: Google liefert ohne
 * Workspace-Admin-SDK keine Gruppen, und eine Mitgliedschaft aus einem Token
 * waere nicht widerrufbar. Das Rechtemodell liegt zentral in der Control Plane
 * (CLAUDE.md, Grundsatz 4), Gruppen gehoeren dazu.
 *
 * Deshalb wird hier auch **nichts gecacht**: jeder Aufruf liest die
 * Mitgliedschaft neu. Ein Widerruf wirkt beim naechsten Request, nicht beim
 * naechsten Login.
 *
 * `denyAllSessions` bleibt der Default im Code und in den Tests. Die echte
 * Verdrahtung passiert in `src/lib/runtime.ts`.
 */

import type { Actor } from '../domain/types';
import { normalizeEmail } from './auth-policy';

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

/** Nur der Lesepfad der Mitgliedschaften — mehr braucht eine Session nicht. */
export interface GroupMembershipLookup {
  groupsFor(email: string): Promise<readonly string[]>;
}

/**
 * Nur das, was dieser Leser von Better Auth braucht: `api.getSession` mit den
 * Headern (und damit den Cookies) des Aufrufs. Als eigene Schnittstelle, damit
 * ein Test keinen OAuth-Anbieter braucht.
 */
export interface BetterAuthSessionApi {
  api: {
    getSession(context: {
      headers: Headers;
    }): Promise<{ user: { id: string; email: string } } | null>;
  };
}

export function createBetterAuthSessionReader(deps: {
  readonly auth: BetterAuthSessionApi;
  readonly groups: GroupMembershipLookup;
}): SessionReader {
  return {
    async read(request: Request): Promise<SessionUser | null> {
      // Die Cookies des Aufrufs, unveraendert weitergegeben. Better Auth prueft
      // Signatur und Ablauf der Session; hier wird nichts selbst entschieden.
      const session = await deps.auth.api.getSession({ headers: new Headers(request.headers) });
      if (session === null) return null;

      const email = normalizeEmail(session.user.email);
      if (session.user.id === '' || email === '') {
        // Eine Session ohne Identitaet ist keine Identitaet.
        return null;
      }

      return {
        userId: session.user.id,
        email,
        groups: await deps.groups.groupsFor(email),
      };
    },
  };
}

export function actorFromSession(user: SessionUser): Actor {
  return { kind: 'user', id: user.userId, groups: user.groups };
}

export function actorFromAgentName(name: string): Actor {
  return { kind: 'agent', id: name };
}
