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
 *
 * **Die Tests laufen nicht als Superuser.** `TEST_DATABASE_URL` ist der
 * Superuser des Test-Containers und dient nur zum Aufraeumen. Die
 * Control Plane selbst bekommt eine eigene Rolle mit `CREATEROLE`, ohne
 * `SUPERUSER` und ohne `BYPASSRLS` — genau so, wie sie im Betrieb laeuft
 * (CLAUDE.md, Konventionen). Frueher liefen die Tests als Superuser; dabei ist
 * nicht aufgefallen, dass `provision_app_schema` ohne Superuser scheitert
 * (Migration 0013).
 */

import pg from 'pg';
import { migrate } from '../src/infra/pg/migrate';
import { closePool } from '../src/infra/pg/pool';

type Pool = pg.Pool;
const { Pool } = pg;

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgres://openapps_owner:openapps_test@localhost:55432/openapps_test';

/** Rolle und Datenbank der Control Plane im Test — wie im Betrieb, kein Superuser. */
const OWNER_ROLE = 'openapps_betrieb';
const OWNER_PASSWORD = 'openapps_test';
const OWNER_DATABASE = 'openapps_betrieb';

/** Die Verbindung, mit der die Control Plane im Test arbeitet. */
export const OWNER_DATABASE_URL = (() => {
  const url = new URL(TEST_DATABASE_URL);
  url.username = OWNER_ROLE;
  url.password = OWNER_PASSWORD;
  url.pathname = `/${OWNER_DATABASE}`;
  return url.toString();
})();

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
 * Setzt die Datenbank auf einen bekannten Stand: neue Datenbank, neue
 * Owner-Rolle ohne Superuser, Migrationen vorwaerts. Die Migrationen laufen hier echt — damit prueft dieser Pfad
 * nebenbei, dass sie ueberhaupt durchlaufen.
 */
export async function freshDatabase(): Promise<PgFixture> {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = OWNER_DATABASE_URL;

  // Aufraeumen als Superuser: Datenbank weg, App-Rollen weg (Rollen gelten
  // fuer den ganzen Cluster, nicht pro Datenbank), Owner-Rolle sicherstellen.
  const superuser = new Pool({ connectionString: TEST_DATABASE_URL });
  try {
    const { rows: me } = await superuser.query<{ rolsuper: boolean }>(
      `SELECT rolsuper FROM pg_roles WHERE rolname = current_user`,
    );
    if (me[0]?.rolsuper !== true) {
      throw new Error(
        'TEST_DATABASE_URL muss ein Superuser sein — nur zum Aufraeumen. Die Tests selbst laufen als eigene Rolle ohne Superuser.',
      );
    }
    await superuser.query(`DROP DATABASE IF EXISTS ${OWNER_DATABASE} WITH (FORCE)`);
    const { rows } = await superuser.query<{ rolname: string }>(
      `SELECT rolname FROM pg_roles WHERE rolname LIKE 'app\\_%'`,
    );
    for (const row of rows) {
      // Fruehere Laeufe (noch als Superuser in der Test-Datenbank) koennen
      // dort Objekte der Rolle hinterlassen haben.
      await superuser.query(`DROP OWNED BY "${row.rolname}" CASCADE`);
      await superuser.query(`DROP ROLE "${row.rolname}"`);
    }
    await superuser.query(`DROP ROLE IF EXISTS ${OWNER_ROLE}`);
    // Dieselben Attribute wie im Betrieb (infra/betrieb/postgres/10-owner.sh).
    await superuser.query(
      `CREATE ROLE ${OWNER_ROLE} LOGIN PASSWORD '${OWNER_PASSWORD}' NOSUPERUSER NOBYPASSRLS NOCREATEDB CREATEROLE NOREPLICATION`,
    );
    await superuser.query(`CREATE DATABASE ${OWNER_DATABASE} OWNER ${OWNER_ROLE}`);
  } finally {
    await superuser.end().catch(() => undefined);
  }

  const pool = new Pool({ connectionString: OWNER_DATABASE_URL });
  const extra: Pool[] = [];

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
      // Der globale Pool, mit dem `migrate()` gelaufen ist.
      await closePool();
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
