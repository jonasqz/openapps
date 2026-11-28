/**
 * Verweise in Postgres (Migration 0020, ADR 0023). Reines SQL wie
 * `events.ts`. Keine Rechte hier: Wer welche Zeile sehen darf, entscheidet
 * die Domaene (`domain/refs.ts`) nach dem Lesen.
 */

import type pg from 'pg';
import type {
  IncomingRef,
  RefRepository,
  StoredRefKind,
  StoredRefTarget,
} from '../../domain/ports';

interface TargetRow extends Record<string, unknown> {
  target: string;
  target_app: string | null;
  kind: StoredRefKind;
}

const toTarget = (row: TargetRow): StoredRefTarget => ({
  ref: row.target,
  kind: row.kind,
  targetApp: row.target_app,
});

/** Braucht eine Verbindung mit Transaktionen (`pg.Pool`). */
export function createRefRepository(pool: pg.Pool): RefRepository {
  return {
    async replace(input) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Neue Quelle: gleich mit ihrem Stand anlegen. Gibt es sie schon (auch
        // durch eine gleichzeitige Meldung, auf die das INSERT wartet), wird
        // sie gesperrt und verglichen; so laufen Meldungen derselben Quelle
        // nacheinander.
        const { rows: created } = await client.query<{ source: string }>(
          `INSERT INTO ref_sources (source, app_name, updated_at)
           VALUES ($1, $2, $3)
           ON CONFLICT (source) DO NOTHING
           RETURNING source`,
          [input.source, input.app, input.updatedAt],
        );
        let previous: TargetRow[] = [];
        if (created.length === 0) {
          const { rows: locked } = await client.query<{ updated_at: Date; app_name: string }>(
            'SELECT updated_at, app_name FROM ref_sources WHERE source = $1 FOR UPDATE',
            [input.source],
          );
          const current = locked[0];
          if (
            current === undefined ||
            current.app_name !== input.app ||
            current.updated_at.getTime() > input.updatedAt.getTime()
          ) {
            await client.query('ROLLBACK');
            return { status: 'stale' };
          }
          previous = (
            await client.query<TargetRow>(
              'SELECT target, target_app, kind FROM refs WHERE source = $1 ORDER BY target',
              [input.source],
            )
          ).rows;
          await client.query('DELETE FROM refs WHERE source = $1', [input.source]);
          await client.query(
            'UPDATE ref_sources SET updated_at = $2, received_at = now() WHERE source = $1',
            [input.source, input.updatedAt],
          );
        }
        if (input.targets.length > 0) {
          await client.query(
            `INSERT INTO refs (source, target, target_app, kind)
             SELECT $1, t.target, t.target_app, t.kind
               FROM unnest($2::text[], $3::text[], $4::text[]) AS t (target, target_app, kind)`,
            [
              input.source,
              input.targets.map((t) => t.ref),
              input.targets.map((t) => t.targetApp),
              input.targets.map((t) => t.kind),
            ],
          );
        }
        await client.query('COMMIT');
        return { status: 'applied', previous: previous.map(toTarget) };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },

    async listIncoming(target, limit) {
      const { rows } = await pool.query<{
        source: string;
        app_name: string;
        kind: StoredRefKind;
        updated_at: Date;
      }>(
        `SELECT r.source, s.app_name, r.kind, s.updated_at
           FROM refs r JOIN ref_sources s ON s.source = r.source
          WHERE r.target = $1
          ORDER BY s.updated_at DESC, r.source
          LIMIT $2`,
        [target, limit],
      );
      return rows.map(
        (row): IncomingRef => ({
          source: row.source,
          sourceApp: row.app_name,
          kind: row.kind,
          updatedAt: row.updated_at,
        }),
      );
    },

    async listOutgoing(source) {
      const { rows } = await pool.query<TargetRow>(
        'SELECT target, target_app, kind FROM refs WHERE source = $1 ORDER BY target',
        [source],
      );
      return rows.map(toTarget);
    },
  };
}
