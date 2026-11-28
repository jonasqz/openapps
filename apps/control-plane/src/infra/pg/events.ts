/**
 * Ereignisse, Benachrichtigungen und Cursor in Postgres (Migrationen 0017
 * bis 0019, ADR 0022). Reines SQL wie `repositories.ts`. Keine Rechte hier:
 * Wer welche Zeile sehen darf, entscheidet die Domaene (`domain/events.ts`)
 * vor jedem Aufruf; diese Datei filtert nur nach dem, was sie bekommt.
 */

import type pg from 'pg';
import type {
  DirectoryUser,
  EventImportance,
  EventRepository,
  InboxRow,
  NotificationState,
  StoredEvent,
  UserDirectory,
} from '../../domain/ports';
import type { Queryable } from './pool';

/** Name des Schemas von Better Auth (Migration 0008), wie `AUTH_DB_SCHEMA`. */
const AUTH_SCHEMA = 'control_plane';

const EVENT_COLUMNS = `
  e.seq, e.app_name, e.event_id, e.type, e.object, e.title, e.path, e.actor,
  e.audience, e.importance, e.occurred_at, e.received_at`;

interface EventRow extends Record<string, unknown> {
  seq: string;
  app_name: string;
  event_id: string;
  type: string;
  object: string;
  title: string;
  path: string;
  actor: string | null;
  audience: string[];
  importance: EventImportance;
  occurred_at: Date;
  received_at: Date;
}

function toEvent(row: EventRow): StoredEvent {
  return {
    seq: Number(row.seq),
    app: row.app_name,
    eventId: row.event_id,
    type: row.type,
    object: row.object,
    title: row.title,
    path: row.path,
    actor: row.actor,
    audience: row.audience,
    importance: row.importance,
    occurredAt: row.occurred_at,
    receivedAt: row.received_at,
  };
}

interface InboxRowSql extends EventRow {
  notification_id: string;
  state: NotificationState;
  via: 'direct' | 'group';
  via_group: string | null;
  created_at: Date;
}

/** Braucht eine Verbindung mit Transaktionen (`pg.Pool`), nicht nur `Queryable`. */
export function createEventRepository(pool: pg.Pool): EventRepository {
  return {
    async exists(app, eventId) {
      const { rows } = await pool.query(
        'SELECT 1 FROM events WHERE app_name = $1 AND event_id = $2',
        [app, eventId],
      );
      return rows.length > 0;
    },

    async insert(event, recipients) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query<EventRow>(
          `INSERT INTO events AS e (app_name, event_id, type, object, title, path, actor,
                                    audience, importance, occurred_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (app_name, event_id) DO NOTHING
           RETURNING ${EVENT_COLUMNS}`,
          [
            event.app,
            event.eventId,
            event.type,
            event.object,
            event.title,
            event.path,
            event.actor,
            [...event.audience],
            event.importance,
            event.occurredAt,
          ],
        );
        const row = rows[0];
        if (row === undefined) {
          await client.query('ROLLBACK');
          return null;
        }
        if (recipients.length > 0) {
          await client.query(
            `INSERT INTO notifications (event_seq, owner_kind, owner_id, via, via_group)
             SELECT $1, r.kind, r.id, r.via, r.via_group
               FROM unnest($2::text[], $3::text[], $4::text[], $5::text[])
                    AS r (kind, id, via, via_group)
             ON CONFLICT (event_seq, owner_kind, owner_id) DO NOTHING`,
            [
              row.seq,
              recipients.map((r) => r.kind),
              recipients.map((r) => r.id),
              recipients.map((r) => r.via),
              recipients.map((r) => r.viaGroup),
            ],
          );
        }
        await client.query('COMMIT');
        return toEvent(row);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },

    async inboxApps(owner) {
      const { rows } = await pool.query<{ app_name: string }>(
        `SELECT DISTINCT e.app_name
           FROM notifications n JOIN events e ON e.seq = n.event_seq
          WHERE n.owner_kind = $1 AND n.owner_id = $2
          ORDER BY e.app_name`,
        [owner.kind, owner.id],
      );
      return rows.map((row) => row.app_name);
    },

    async listInbox(query) {
      if (query.apps.length === 0 || query.states.length === 0) return [];
      const { rows } = await pool.query<InboxRowSql>(
        `SELECT n.id AS notification_id, n.state, n.via, n.via_group, n.created_at,
                ${EVENT_COLUMNS}
           FROM notifications n JOIN events e ON e.seq = n.event_seq
          WHERE n.owner_kind = $1 AND n.owner_id = $2
            AND e.app_name = ANY ($3::text[])
            AND n.state = ANY ($4::text[])
          ORDER BY (n.via = 'direct') DESC,
                   CASE e.importance WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
                   e.occurred_at DESC,
                   n.id
          LIMIT $5`,
        [query.owner.kind, query.owner.id, [...query.apps], [...query.states], query.limit],
      );
      return rows.map(
        (row): InboxRow => ({
          id: row.notification_id,
          state: row.state,
          via: row.via,
          viaGroup: row.via_group,
          createdAt: row.created_at,
          event: toEvent(row),
        }),
      );
    },

    async countInbox(owner, apps, state) {
      if (apps.length === 0) return 0;
      const { rows } = await pool.query<{ n: number }>(
        `SELECT count(*)::int AS n
           FROM notifications n JOIN events e ON e.seq = n.event_seq
          WHERE n.owner_kind = $1 AND n.owner_id = $2
            AND e.app_name = ANY ($3::text[]) AND n.state = $4`,
        [owner.kind, owner.id, [...apps], state],
      );
      return Number(rows[0]?.n ?? 0);
    },

    async markInbox(owner, ids, apps, state, at) {
      if (ids.length === 0 || apps.length === 0) return 0;
      const { rowCount } = await pool.query(
        `UPDATE notifications n
            SET state = $5, updated_at = $6
           FROM events e
          WHERE e.seq = n.event_seq
            AND n.owner_kind = $1 AND n.owner_id = $2
            AND n.id = ANY ($3::uuid[])
            AND e.app_name = ANY ($4::text[])`,
        [owner.kind, owner.id, [...ids], [...apps], state, at],
      );
      return rowCount ?? 0;
    },

    async pollEvents(input) {
      if (input.subscriptions.length === 0) return [];
      const { rows } = await pool.query<EventRow>(
        `SELECT ${EVENT_COLUMNS}
           FROM events e
           JOIN unnest($2::text[], $3::text[]) AS s (app, type)
             ON s.app = e.app_name AND s.type = e.type
           LEFT JOIN event_cursors c
             ON c.subscriber = $1 AND c.source_app = e.app_name AND c.type = e.type
          WHERE e.seq > COALESCE(c.position, 0)
          ORDER BY e.seq
          LIMIT $4`,
        [
          input.subscriber,
          input.subscriptions.map((s) => s.app),
          input.subscriptions.map((s) => s.type),
          input.limit,
        ],
      );
      return rows.map(toEvent);
    },

    async ackEvents(input) {
      if (input.subscriptions.length === 0) return 0;
      const { rowCount } = await pool.query(
        `INSERT INTO event_cursors AS c (subscriber, source_app, type, position, updated_at)
         SELECT $1, s.app, s.type, $4, $5
           FROM unnest($2::text[], $3::text[]) AS s (app, type)
         ON CONFLICT (subscriber, source_app, type) DO UPDATE
            SET position = GREATEST(c.position, EXCLUDED.position),
                updated_at = EXCLUDED.updated_at`,
        [
          input.subscriber,
          input.subscriptions.map((s) => s.app),
          input.subscriptions.map((s) => s.type),
          input.upTo,
          input.at,
        ],
      );
      return rowCount ?? 0;
    },

    async maxSeq() {
      const { rows } = await pool.query<{ max: string | null }>(
        'SELECT max(seq)::text AS max FROM events',
      );
      return Number(rows[0]?.max ?? 0);
    },

    async purgeReceivedBefore(cutoff) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const counted = await client.query<{ n: number }>(
          `SELECT count(*)::int AS n
             FROM notifications n JOIN events e ON e.seq = n.event_seq
            WHERE e.received_at < $1`,
          [cutoff],
        );
        const removed = await client.query('DELETE FROM events WHERE received_at < $1', [cutoff]);
        await client.query('COMMIT');
        return { events: removed.rowCount ?? 0, notifications: Number(counted.rows[0]?.n ?? 0) };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

interface UserRow extends Record<string, unknown> {
  id: string;
  email: string;
  name: string;
}

function toUser(row: UserRow | undefined): DirectoryUser | null {
  return row === undefined ? null : { id: row.id, email: row.email.toLowerCase(), name: row.name };
}

/** Nur lesend auf die Tabelle von Better Auth (Migration 0008). */
export function createUserDirectory(db: Queryable): UserDirectory {
  return {
    async findById(id) {
      const { rows } = await db.query<UserRow>(
        `SELECT id, email, name FROM ${AUTH_SCHEMA}."user" WHERE id = $1`,
        [id],
      );
      return toUser(rows[0]);
    },
    async findByEmail(email) {
      const { rows } = await db.query<UserRow>(
        `SELECT id, email, name FROM ${AUTH_SCHEMA}."user" WHERE lower(email) = lower($1)
          ORDER BY id LIMIT 1`,
        [email.trim()],
      );
      return toUser(rows[0]);
    },
  };
}
