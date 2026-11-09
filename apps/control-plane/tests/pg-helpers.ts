/**
 * Zugang zur Test-Postgres-Instanz aus `docker-compose.yml`.
 *
 * Grundregel: Fehlt die Instanz, werden die Tests **uebersprungen**, nicht als
 * Fehler gemeldet. Ein fehlender Container ist ein fehlender Nachweis, kein
 * fehlgeschlagener — und `pnpm check` soll auf einem Rechner ohne Docker nicht
 * rot sein.
 *
 * Erreichbar heisst: `TEST_DATABASE_URL` (oder der Default unten) nimmt eine
 * Verbindung an.
 */

import { Pool } from 'pg';
import { migrate } from '../src/infra/pg/migrate';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgres://openapps_owner:openapps_test@localhost:55432/openapps_test';

/**
 * Einmal pruefen, nicht pro Test: `describe.skipIf` braucht die Antwort
 * synchron, also wird sie beim Laden der Datei geholt.
 */
export async function postgresReachable(): Promise<boolean> {
  const probe = new Pool({ connectionString: TEST_DATABASE_URL, connectionTimeoutMillis: 1500 });
  try {
    await probe.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await probe.end().catch(() => undefined);
  }
}

export interface PgFixture {
  readonly pool: Pool;
  /** Verbindung als eine App-Rolle, mit dem Passwort aus dem Provisioning. */
  connectAs(dsn: string): Pool;
  close(): Promise<void>;
}

/**
 * Setzt die Datenbank auf einen bekannten Stand: alles weg, Migrationen
 * vorwaerts. Die Migrationen laufen hier echt — damit prueft dieser Pfad
 * nebenbei, dass sie ueberhaupt durchlaufen.
 */
export async function freshDatabase(): Promise<PgFixture> {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = TEST_DATABASE_URL;

  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  const extra: Pool[] = [];

  // Alles aus einem frueheren Lauf entfernen — auch die App-Rollen, die nicht
  // zu einem Schema gehoeren.
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
  await pool.query('CREATE SCHEMA public');
  const { rows } = await pool.query<{ rolname: string }>(
    `SELECT rolname FROM pg_roles WHERE rolname LIKE 'app\\_%'`,
  );
  for (const row of rows) {
    await pool.query(`DROP SCHEMA IF EXISTS "${row.rolname}" CASCADE`);
    await pool.query(`DROP OWNED BY "${row.rolname}" CASCADE`);
    await pool.query(`DROP ROLE "${row.rolname}"`);
  }

  await migrate();

  return {
    pool,
    connectAs(dsn: string): Pool {
      const appPool = new Pool({ connectionString: dsn, connectionTimeoutMillis: 2000 });
      extra.push(appPool);
      return appPool;
    },
    async close(): Promise<void> {
      await Promise.all(extra.map((p) => p.end().catch(() => undefined)));
      await pool.end().catch(() => undefined);
      if (previous === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previous;
      }
    },
  };
}

/** Die Fehlermeldung eines erwartet scheiternden SQL-Aufrufs, oder `null`. */
export async function sqlError(pool: Pool, sql: string): Promise<string | null> {
  try {
    await pool.query(sql);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
