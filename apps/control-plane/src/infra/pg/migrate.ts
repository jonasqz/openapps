/**
 * Migrations-Laeufer. Vorwaerts, in Nummernfolge, jede genau einmal. Es gibt
 * absichtlich kein "down": eine Korrektur ist eine neue Migration.
 *
 * Aufruf: `pnpm --filter @openapps/control-plane migrate`
 */

import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { getPool } from './pool';

const MIGRATIONS_DIR = path.join(process.cwd(), 'migrations');

export async function migrate(): Promise<readonly string[]> {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text        PRIMARY KEY,
      checksum   text        NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));

  const { rows } = await pool.query<{ name: string; checksum: string }>(
    `SELECT name, checksum FROM schema_migrations`,
  );
  const applied = new Map(rows.map((r) => [r.name, r.checksum]));
  const ran: string[] = [];

  for (const file of files) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const previous = applied.get(file);

    if (previous !== undefined) {
      if (previous !== checksum) {
        // Eine bereits gelaufene Migration wurde geaendert. Das ist der Fehler,
        // den CLAUDE.md ausschliesst, und er bricht hier ab statt still zu
        // divergieren.
        throw new Error(
          `Migration ${file} wurde nach dem Anwenden geaendert. Bestehende Migrationen bleiben unveraendert; lege eine neue an.`,
        );
      }
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)`, [
        file,
        checksum,
      ]);
      await client.query('COMMIT');
      ran.push(file);
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${file} fehlgeschlagen: ${String(error)}`);
    } finally {
      client.release();
    }
  }

  return ran;
}

const invokedDirectly = process.argv[1] !== undefined && process.argv[1].endsWith('migrate.ts');
if (invokedDirectly) {
  migrate()
    .then((ran) => {
      process.stdout.write(
        ran.length === 0 ? 'keine neue Migration\n' : `angewendet: ${ran.join(', ')}\n`,
      );
      return getPool().end();
    })
    .catch((error: unknown) => {
      process.stderr.write(`${String(error)}\n`);
      process.exitCode = 1;
    });
}
