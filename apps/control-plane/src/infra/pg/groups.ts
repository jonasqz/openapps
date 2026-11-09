/**
 * Gruppen-Mitgliedschaften (Migration 0009). Sie sind Teil des Rechtemodells,
 * also liegen sie hier und nicht in einem Token: Google liefert ohne
 * Workspace-Admin-SDK keine Gruppen, und selbst wenn — eine Freigabe, die aus
 * einem Token kommt, waere nicht widerrufbar (CLAUDE.md, Grundsatz 4).
 *
 * **Kein Cache.** Jede Abfrage geht an die Datenbank. Wird eine Mitgliedschaft
 * entzogen, sieht der naechste Aufruf das sofort. Ein Cache ueber eine Session
 * hinaus waere ein Widerruf, der nicht wirkt.
 */

import { normalizeEmail } from '../../lib/auth-policy';
import type { Queryable } from './pool';

export interface GroupMembershipRepository {
  /** Gruppen dieser Adresse, alphabetisch. Unbekannt heisst leer, nicht Fehler. */
  groupsFor(email: string): Promise<readonly string[]>;
  /** Idempotent: zweimal dieselbe Mitgliedschaft ist keine Aenderung. */
  ensureMembership(group: string, email: string, addedBy: string): Promise<void>;
  removeMembership(group: string, email: string): Promise<void>;
}

export function createGroupMembershipRepository(db: Queryable): GroupMembershipRepository {
  return {
    async groupsFor(email: string): Promise<readonly string[]> {
      const normalized = normalizeEmail(email);
      if (normalized === '') return [];
      const { rows } = await db.query<{ group_name: string }>(
        `SELECT group_name FROM group_members WHERE email = $1 ORDER BY group_name`,
        [normalized],
      );
      return rows.map((row) => row.group_name);
    },

    async ensureMembership(group: string, email: string, addedBy: string): Promise<void> {
      // Die Gruppe muss existieren (FK). Sie anzulegen ist kein Nebeneffekt
      // einer Mitgliedschaft, sondern eine eigene Entscheidung — ausser fuer
      // `platform-admins`, die Migration 0009 schon angelegt hat.
      await db.query(
        `INSERT INTO group_members (group_name, email, added_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (group_name, email) DO NOTHING`,
        [group, normalizeEmail(email), addedBy],
      );
    },

    async removeMembership(group: string, email: string): Promise<void> {
      await db.query(`DELETE FROM group_members WHERE group_name = $1 AND email = $2`, [
        group,
        normalizeEmail(email),
      ]);
    },
  };
}
