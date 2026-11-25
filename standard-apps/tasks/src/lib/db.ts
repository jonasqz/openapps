import { createAppPool } from '@openapps/sdk';

/**
 * Der Pool dieser App. Er ist auf das eigene Schema festgenagelt — `search_path`
 * kommt aus `DATABASE_SCHEMA` und gilt ab der ersten Anweisung jeder Verbindung.
 *
 * Baue keine zweite Verbindung: fremde Daten kommen über eine Freigabe in der
 * Control Plane, nicht über eine andere DSN. `pg` wird hier absichtlich nicht
 * importiert — eine App redet nicht selbst mit dem Treiber, das SDK tut es.
 */
type AppPool = ReturnType<typeof createAppPool>;

let pool: AppPool | undefined;

function appPool(): AppPool {
  pool ??= createAppPool();
  return pool;
}

/** Eine Abfrage im eigenen Schema. */
export async function query<Row extends Record<string, unknown>>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<Row[]> {
  const result = await appPool().query<Row>(sql, [...params]);
  return result.rows;
}
