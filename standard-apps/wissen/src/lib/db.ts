import { createAppPool } from '@openapps/sdk';

/**
 * Der Pool dieser App. Er ist auf das eigene Schema festgenagelt — `search_path`
 * kommt aus `DATABASE_SCHEMA` und gilt ab der ersten Anweisung jeder Verbindung.
 *
 * Baue keine zweite Verbindung: fremde Daten kommen ueber eine Freigabe in der
 * Control Plane, nicht ueber eine andere DSN. `pg` wird hier absichtlich nicht
 * importiert — eine App redet nicht selbst mit dem Treiber, das SDK tut es.
 */
export type AppPool = ReturnType<typeof createAppPool>;

let pool: AppPool | undefined;

/** Der eine Pool, beim ersten Gebrauch angelegt. Wirft, wenn die Env fehlt. */
export function appPool(): AppPool {
  pool ??= createAppPool();
  return pool;
}

/**
 * Eine Abfrage. Die Fachlogik haengt nur an dieser Form, nicht am Pool —
 * so laeuft derselbe Code im Pool und in einer Transaktion.
 */
export type QueryFn = <Row extends Record<string, unknown>>(
  sql: string,
  params?: readonly unknown[],
) => Promise<Row[]>;

/** Eine Abfrage im eigenen Schema. */
export const query: QueryFn = async <Row extends Record<string, unknown>>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<Row[]> => {
  const result = await appPool().query<Row>(sql, [...params]);
  return result.rows;
};

/**
 * Fuehrt `work` in einer Transaktion auf einer eigenen Verbindung aus.
 * Wirft `work`, wird zurueckgerollt und der Fehler weitergereicht.
 */
export async function withTransaction<T>(work: (tx: QueryFn) => Promise<T>): Promise<T> {
  const client = await appPool().connect();
  const tx: QueryFn = async <Row extends Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<Row[]> => (await client.query<Row>(sql, [...params])).rows;

  // Eine Verbindung, deren Rollback scheitert, geht nicht zurueck in den Pool.
  let broken = false;
  try {
    await client.query('begin');
    const result = await work(tx);
    await client.query('commit');
    return result;
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      // Der urspruengliche Fehler zaehlt, nicht der des Rollbacks.
      broken = true;
    }
    throw error;
  } finally {
    client.release(broken);
  }
}
