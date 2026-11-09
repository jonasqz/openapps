/**
 * Gruppen und Mitgliedschaften in Postgres (Migration 0009). Sie sind Teil des
 * Rechtemodells, also liegen sie hier und nicht in einem Token: Google liefert
 * ohne Workspace-Admin-SDK keine Gruppen, und selbst wenn — eine Freigabe, die
 * aus einem Token kommt, waere nicht widerrufbar (CLAUDE.md, Grundsatz 4).
 *
 * **Kein Cache.** Jede Abfrage geht an die Datenbank. Wird eine Mitgliedschaft
 * entzogen, sieht der naechste Aufruf das sofort. Ein Cache ueber eine Session
 * hinaus waere ein Widerruf, der nicht wirkt.
 */

import { ConflictError } from '../../domain/errors';
import { normalizeEmail } from '../../lib/auth-policy';
import type { GroupRepository } from '../../domain/ports';
import type { Group, GroupMember } from '../../domain/types';
import type { Queryable } from './pool';

/**
 * Der schmale Teil, den die Anmeldung braucht: Gruppen lesen und den
 * Bootstrap-Administrator aufnehmen. Better Auth soll nicht die ganze
 * Gruppenpflege in der Hand haben, nur diese drei Methoden.
 */
export type GroupMembershipRepository = Pick<
  GroupRepository,
  'groupsFor' | 'ensureMembership' | 'removeMembership'
>;

interface GroupRow extends Record<string, unknown> {
  readonly name: string;
  readonly description: string;
  readonly created_at: Date;
}

interface MemberRow extends Record<string, unknown> {
  readonly email: string;
  readonly added_by: string;
  readonly added_at: Date;
}

function toGroup(row: GroupRow): Group {
  return { name: row.name, description: row.description, createdAt: row.created_at };
}

function toMember(row: MemberRow): GroupMember {
  return { email: row.email, addedBy: row.added_by, addedAt: row.added_at };
}

export function createGroupRepository(db: Queryable): GroupRepository {
  return {
    async create(input: { name: string; description: string }): Promise<Group> {
      // `ON CONFLICT DO NOTHING` plus leere Rueckgabe statt eines gefangenen
      // Fehlers: So bleibt der Fall „gibt es schon" eine Entscheidung dieser
      // Funktion und nicht die Deutung eines Fehlercodes.
      const { rows } = await db.query<GroupRow>(
        `INSERT INTO groups (name, description)
         VALUES ($1, $2)
         ON CONFLICT (name) DO NOTHING
         RETURNING name, description, created_at`,
        [input.name, input.description],
      );
      const row = rows[0];
      if (row === undefined) throw new ConflictError(`Gruppe "${input.name}" gibt es schon`);
      return toGroup(row);
    },

    async findByName(name: string): Promise<Group | null> {
      const { rows } = await db.query<GroupRow>(
        `SELECT name, description, created_at FROM groups WHERE name = $1`,
        [name],
      );
      const row = rows[0];
      return row === undefined ? null : toGroup(row);
    },

    async listAll(): Promise<readonly Group[]> {
      const { rows } = await db.query<GroupRow>(
        `SELECT name, description, created_at FROM groups ORDER BY name`,
      );
      return rows.map(toGroup);
    },

    async listMembers(group: string): Promise<readonly GroupMember[]> {
      const { rows } = await db.query<MemberRow>(
        `SELECT email, added_by, added_at FROM group_members
         WHERE group_name = $1 ORDER BY email`,
        [group],
      );
      return rows.map(toMember);
    },

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

/**
 * Derselbe Speicher, nur schmaler getypt. Es gibt absichtlich **eine**
 * Implementierung: Zwei Wege in dieselben zwei Tabellen koennten in der
 * Normalisierung auseinanderlaufen, und dann haette dieselbe Adresse je nach
 * Aufrufpfad andere Gruppen.
 */
export function createGroupMembershipRepository(db: Queryable): GroupMembershipRepository {
  return createGroupRepository(db);
}
