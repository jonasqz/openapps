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

/** Eine Abfrage — mit dem Pool oder innerhalb einer Transaktion. */
export type Query = <Row extends Record<string, unknown>>(
  sql: string,
  params?: readonly unknown[],
) => Promise<Row[]>;

/** Eine Abfrage im eigenen Schema. */
export const query: Query = async <Row extends Record<string, unknown>>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<Row[]> => {
  const result = await appPool().query<Row>(sql, [...params]);
  return result.rows;
};

/**
 * Fuehrt `work` in einer Transaktion aus. Wirft `work`, wird alles
 * zurueckgerollt und der Fehler weitergereicht.
 */
export async function withTransaction<T>(work: (q: Query) => Promise<T>): Promise<T> {
  const client = await appPool().connect();
  const q: Query = async <Row extends Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<Row[]> => (await client.query<Row>(sql, [...params])).rows;
  try {
    await client.query('begin');
    const result = await work(q);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
