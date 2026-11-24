import { createAppPool } from '@openapps/sdk';

/**
 * Der Pool dieser App. Er ist auf das eigene Schema festgenagelt — `search_path`
 * kommt aus `DATABASE_SCHEMA` und gilt ab der ersten Anweisung jeder Verbindung.
 *
 * Baue keine zweite Verbindung: fremde Daten kommen über eine Freigabe in der
 * Control Plane, nicht über eine andere DSN. `pg` wird hier absichtlich nicht
 * importiert — eine App redet nicht selbst mit dem Treiber, das SDK tut es.
 */
export type AppPool = ReturnType<typeof createAppPool>;

let pool: AppPool | undefined;

/** Der eine Pool, beim ersten Gebrauch angelegt. Auch fuer die Migrationen. */
export function appPool(): AppPool {
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

/** Abfragen innerhalb einer Transaktion. */
export interface Tx {
  query<Row extends Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<Row[]>;
}

/**
 * Fuehrt `work` in einer Transaktion aus. Wirft `work`, wird zurueckgerollt und
 * der Fehler weitergereicht — eine Seite ohne ihre Revision bleibt nie stehen.
 */
export async function transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await appPool().connect();
  const tx: Tx = {
    async query<Row extends Record<string, unknown>>(
      sql: string,
      params: readonly unknown[] = [],
    ): Promise<Row[]> {
      const result = await client.query<Row>(sql, [...params]);
      return result.rows;
    },
  };
  // Scheitert das Zurueckrollen, ist die Verbindung in unbekanntem Zustand und
  // wird verworfen statt in den Pool zurueckgegeben.
  let broken: Error | undefined;
  try {
    await client.query('begin');
    const result = await work(tx);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch((rollbackError: unknown) => {
      broken = rollbackError instanceof Error ? rollbackError : new Error('rollback failed');
    });
    throw error;
  } finally {
    client.release(broken);
  }
}
