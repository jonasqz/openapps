/**
 * Die Verbindung der Control Plane. Sie laeuft mit der Owner-Rolle, weil sie
 * Schemata und App-Rollen anlegt — aber auch sie ist weder SUPERUSER noch
 * BYPASSRLS. Die App-Rollen bekommt sie ueber `provision_app_schema`.
 */

import { Pool } from 'pg';

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
