import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type pg from 'pg';
import { SdkConfigurationError } from './errors.js';

/**
 * Fuehrt die Migrationen einer App in ihrem eigenen Schema aus.
 *
 * Wer das darf: die Rolle der App selbst. `provision_app_schema` legt das
 * Schema mit `AUTHORIZATION <rolle>` an — die App ist Eigentuemerin ihres
 * Schemas und von nichts sonst. Der `search_path` kommt aus dem Pool
 * (`createAppPool`), also landen unqualifizierte Namen im eigenen Schema.
 *
 * Regeln, die hier durchgesetzt werden, nicht nur in der Doku stehen:
 *
 * - **Aufsteigend nach Dateiname**, `0001_…sql` vor `0002_…sql`.
 * - **Jede Datei genau einmal**, in einer Transaktion. Scheitert sie, bleibt
 *   nichts davon stehen und die App startet nicht.
 * - **Nie eine bestehende aendern** (CLAUDE.md): Die Pruefsumme jeder
 *   angewendeten Datei wird gespeichert. Weicht sie spaeter ab, bricht der Lauf
 *   ab, statt einen Stand vorzutaeuschen, den die Datenbank nicht hat.
 * - **Ein Lauf zur Zeit**: Advisory-Lock pro Schema, damit zwei Instanzen
 *   derselben App nicht gleichzeitig migrieren.
 */

export const MIGRATIONS_TABLE = 'openapps_migrations';

const FILE_PATTERN = /^\d{4}_[a-z0-9_]+\.sql$/;

export interface MigrationResult {
  readonly applied: readonly string[];
  readonly skipped: readonly string[];
}

export async function runMigrations(pool: pg.Pool, directory: string): Promise<MigrationResult> {
  return runSqlFiles(pool, directory, '');
}

/** Praefix der Beispieldaten in `openapps_migrations`: `seed/0001_….sql`. */
export const SEED_PREFIX = 'seed/';

/**
 * Spielt Beispieldaten ein (`seeds/`), aber nur, wenn die Plattform es
 * verlangt: `OPENAPPS_SAMPLE_DATA=1` in der Env der App. Im lokalen Betrieb
 * setzt die Control Plane das, auf dem Server nicht — dort bleibt eine frische
 * App leer.
 *
 * Gleiche Regeln wie bei Migrationen (einmal, Pruefsumme, Transaktion), aber
 * gefuehrt unter eigenem Namen, damit `seeds/0001_x.sql` nie mit
 * `migrations/0001_x.sql` zusammenfaellt. Immer **nach** `runMigrations`
 * aufrufen.
 */
export async function runSeeds(
  pool: pg.Pool,
  directory: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<MigrationResult | null> {
  if (env.OPENAPPS_SAMPLE_DATA !== '1') return null;
  // Eine App ohne Beispieldaten hat keinen Ordner `seeds/`. Das ist kein
  // Fehler und darf ihren Start nicht verhindern.
  try {
    await stat(directory);
  } catch {
    return { applied: [], skipped: [] };
  }
  return runSqlFiles(pool, directory, SEED_PREFIX);
}

async function runSqlFiles(
  pool: pg.Pool,
  directory: string,
  prefix: string,
): Promise<MigrationResult> {
  const files = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  for (const name of files) {
    if (!FILE_PATTERN.test(name)) {
      throw new SdkConfigurationError(
        `Migration "${name}" has no valid name. Expected: 0001_description.sql`,
      );
    }
  }

  const client = await pool.connect();
  const applied: string[] = [];
  const skipped: string[] = [];
  try {
    await client.query('select pg_advisory_lock(hashtext(current_schema()))');
    try {
      await client.query(
        `create table if not exists ${MIGRATIONS_TABLE} (
           name       text primary key,
           checksum   text not null,
           applied_at timestamptz not null default now()
         )`,
      );
      const done = new Map(
        (
          await client.query<{ name: string; checksum: string }>(
            `select name, checksum from ${MIGRATIONS_TABLE}`,
          )
        ).rows.map((row) => [row.name, row.checksum]),
      );

      for (const file of files) {
        const name = `${prefix}${file}`;
        const sql = await readFile(join(directory, file), 'utf8');
        const checksum = createHash('sha256').update(sql).digest('hex');
        const previous = done.get(name);
        if (previous !== undefined) {
          if (previous !== checksum) {
            throw new SdkConfigurationError(
              `Migration "${name}" was changed after it was applied. Never change an existing migration; add a new one.`,
            );
          }
          skipped.push(name);
          continue;
        }

        await client.query('begin');
        try {
          await client.query(sql);
          await client.query(`insert into ${MIGRATIONS_TABLE} (name, checksum) values ($1, $2)`, [
            name,
            checksum,
          ]);
          await client.query('commit');
        } catch (error) {
          await client.query('rollback');
          throw new SdkConfigurationError(`Migration "${name}" failed`, {
            cause: error,
          });
        }
        applied.push(name);
      }
    } finally {
      await client.query('select pg_advisory_unlock(hashtext(current_schema()))');
    }
  } finally {
    client.release();
  }

  return { applied, skipped };
}
