/**
 * Die Verbindung der Control Plane. Sie laeuft mit der Owner-Rolle, weil sie
 * Schemata und App-Rollen anlegt — aber auch sie ist weder SUPERUSER noch
 * BYPASSRLS. Die App-Rollen bekommt sie ueber `provision_app_schema`.
 */

// `pg` ist CommonJS. Ein benannter Import (`import { Pool } from 'pg'`)
// klappt unter vitest und im Next-Bundle, scheitert aber unter Node-ESM —
// und genau dort laeuft `pnpm migrate` im Container. Der Default-Import
// funktioniert ueberall.
import pg from 'pg';

const { Pool } = pg;
type Pool = pg.Pool;

export interface Queryable {
  query<R extends Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}

let pool: Pool | undefined;

export function getPool(): Pool {
  if (pool === undefined) {
    const connectionString = process.env.DATABASE_URL;
    if (connectionString === undefined || connectionString === '') {
      throw new Error('Env-Variable DATABASE_URL fehlt');
    }
    pool = new Pool({ connectionString, max: Number(process.env.DATABASE_POOL_MAX ?? '10') });
  }
  return pool;
}

/**
 * Schliesst den Pool und vergisst ihn; der naechste `getPool()` baut neu auf.
 * Im Betrieb nicht noetig. Die Postgres-Tests legen pro Test eine neue
 * Datenbank an und muessen die Verbindungen zur alten vorher loslassen —
 * sonst trennt `DROP DATABASE ... WITH (FORCE)` sie mitten im naechsten Lauf.
 */
export async function closePool(): Promise<void> {
  const current = pool;
  pool = undefined;
  await current?.end().catch(() => undefined);
}
