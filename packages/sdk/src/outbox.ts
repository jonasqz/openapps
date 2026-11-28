import { AppCallError } from './app-call.js';

/**
 * Die Outbox einer App (ADR 0020 D, ADR 0022 B): Was eine App an die
 * Plattform oder eine andere App liefern will, schreibt sie **in derselben
 * Transaktion** wie die Aenderung in eine Tabelle ihres eigenen Schemas.
 * Nach dem Commit liefert die Outbox, ohne dass das Speichern darauf wartet;
 * scheitert die Lieferung, bleibt der Eintrag stehen und wird beim naechsten
 * Anstoss, beim Start und im Takt wiederholt. Speichern scheitert so nie an
 * einem anderen Dienst.
 *
 * Gehoben aus dem Wiki (`standard-apps/wiki/src/lib/search-sync.ts`), weil es
 * mit den Ereignissen den zweiten Nutzer gibt (Muster aus ADR 0019).
 *
 * ## Die Tabelle
 *
 * Die App legt sie selbst per Migration an, im eigenen Schema:
 *
 * ```sql
 * create sequence event_outbox_version_seq;
 * create table event_outbox (
 *   key             text primary key,
 *   version         bigint not null default nextval('event_outbox_version_seq'),
 *   payload         jsonb,
 *   enqueued_at     timestamptz not null default now(),
 *   attempts        integer not null default 0 check (attempts >= 0),
 *   last_error      text check (last_error is null or length(last_error) <= 1000),
 *   last_attempt_at timestamptz
 * );
 * create index event_outbox_order_idx on event_outbox (attempts, version);
 * ```
 *
 * Name der Tabelle, der Schluessel-Spalte und der Sequenz sind einstellbar
 * (das Wiki fuehrt `search_outbox` mit `page_id` und ohne `payload`).
 *
 * ## Versionen
 *
 * Ein Eintrag wird nur mit der Version geloescht, die geliefert wurde. Wird
 * derselbe Schluessel waehrend der Lieferung neu eingereiht (`requeue`),
 * bekommt er eine neue Version und bleibt stehen. So geht nichts verloren.
 */

/** Eine Abfrage im eigenen Schema: mit dem Pool oder in einer Transaktion. */
export type OutboxQuery = <Row extends Record<string, unknown>>(
  sql: string,
  params?: readonly unknown[],
) => Promise<Row[]>;

/** Ein Eintrag, wie `deliver` ihn bekommt. */
export interface OutboxEntry {
  readonly key: string;
  /** Fortlaufende Version als Text (bigint). */
  readonly version: string;
  /** Inhalt der Spalte `payload`, oder `null` ohne Spalte. */
  readonly payload: unknown;
  readonly attempts: number;
}

export interface OutboxLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface OutboxOptions {
  /** Praefix im Log, etwa `[wiki] search sync`. */
  readonly name: string;
  /** Tabelle im eigenen Schema. */
  readonly table: string;
  /** Schluessel-Spalte. Default `key`. */
  readonly keyColumn?: string;
  /** Spalte mit dem Inhalt; `null` heisst: keine. Default `payload`. */
  readonly payloadColumn?: string | null;
  /** Sequenz der Versionen. Default `<table>_version_seq`. */
  readonly versionSequence?: string;
  /** Abfragen ausserhalb einer Transaktion (Pool). */
  readonly query: OutboxQuery;
  /** Liefert einen Eintrag. Wirft, wenn es nicht geklappt hat. */
  readonly deliver: (entry: OutboxEntry) => Promise<void>;
  /**
   * Lohnt es, nach diesem Fehler mit dem naechsten Eintrag weiterzumachen?
   * Default: nein, ausser die Plattform hat genau diesen Eintrag abgelehnt
   * (`invalid`, `not_found`).
   */
  readonly stopsBatch?: (error: unknown) => boolean;
  /** Eintraege je Durchlauf. Default 50. */
  readonly batchSize?: number;
  /** So oft wird nachgesehen, ob noch etwas aussteht. Default 60 000 ms. */
  readonly retryIntervalMs?: number;
  /** Default `console`. */
  readonly logger?: OutboxLogger;
}

export interface OutboxDeliveryReport {
  delivered: number;
  failed: number;
  /** Was nach diesem Durchlauf noch aussteht. */
  pending: number;
  /** Abgebrochen, weil der Empfaenger gerade nicht annimmt. */
  stopped: boolean;
  lastError: string | null;
}

export interface OutboxStatus {
  pending: number;
  failing: number;
  oldestEnqueuedAt: string | null;
  /** Die Eintraege mit den meisten Fehlversuchen. */
  errors: {
    key: string;
    attempts: number;
    lastError: string | null;
    lastAttemptAt: string | null;
  }[];
}

export interface OutboxEnqueueEntry {
  readonly key: string;
  /** Nur mit Spalte `payload`. Wird als JSON gespeichert. */
  readonly payload?: unknown;
}

export interface Outbox {
  /**
   * Reiht Eintraege ein. **Nur in der Transaktion der Aenderung** aufrufen,
   * mit deren Abfrage. `requeue` (Default) setzt einen schon wartenden
   * Eintrag mit neuer Version zurueck; `ignore` laesst ihn, wie er ist (fuer
   * Ereignisse: dieselbe Id ist dasselbe Ereignis). Erwartet eine
   * Schluessel-Spalte vom Typ `text`; wer einen anderen Typ fuehrt (das Wiki:
   * `uuid`), reiht mit eigenem SQL und `requeueClause` ein.
   */
  enqueue(
    q: OutboxQuery,
    entries: readonly OutboxEnqueueEntry[],
    options?: { readonly onConflict?: 'requeue' | 'ignore' },
  ): Promise<void>;
  /** `on conflict (...) do update ...` fuer eigene Einreihungen (etwa ein ganzer Teilbaum). */
  readonly requeueClause: string;
  /** Ein Durchlauf ueber hoechstens `limit` Eintraege, die mit den wenigsten Fehlversuchen zuerst. */
  deliverPending(limit?: number): Promise<OutboxDeliveryReport>;
  pending(): Promise<number>;
  /** Stoesst die Lieferung an und kehrt sofort zurueck. Wirft nie. */
  kick(): void;
  /** Wartet auf eine laufende Lieferung. */
  settle(): Promise<void>;
  /** Liefert jetzt und sieht danach im Takt nach. Mehrfacher Aufruf startet nur einen Takt. */
  start(): void;
  /** Haelt den Takt an (Tests, Herunterfahren). */
  stop(): void;
  status(limit?: number): Promise<OutboxStatus>;
}

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;
const LAST_ERROR_MAX = 1000;

function identifier(value: string, what: string): string {
  if (!IDENTIFIER.test(value)) {
    throw new Error(`outbox: ${what} "${value}" is not a plain Postgres name of [a-z0-9_]`);
  }
  return value;
}

/** Default fuer `stopsBatch`: dieselbe Regel wie im Wiki seit 0.3.0. */
export function outboxStopsBatch(error: unknown): boolean {
  if (!(error instanceof AppCallError)) return true;
  return error.code !== 'invalid' && error.code !== 'not_found';
}

/**
 * Text fuer `last_error`. `AppCallError`-Meldungen enthalten nie ein Secret
 * (SDK); alles andere wird nur mit seinem Namen notiert, nicht mit seiner
 * Meldung, weil die eine Adresse samt Zugangsdaten tragen koennte.
 */
export function describeOutboxError(error: unknown): string {
  const text =
    error instanceof AppCallError
      ? `${error.code}: ${error.message}`
      : error instanceof Error
        ? `${error.name}: delivery failed`
        : 'delivery failed';
  return text.slice(0, LAST_ERROR_MAX);
}

export function createOutbox(options: OutboxOptions): Outbox {
  const table = identifier(options.table, 'table');
  const key = identifier(options.keyColumn ?? 'key', 'key column');
  const payload =
    options.payloadColumn === null
      ? null
      : identifier(options.payloadColumn ?? 'payload', 'payload column');
  const sequence = identifier(options.versionSequence ?? `${table}_version_seq`, 'sequence');
  const batchSize = options.batchSize ?? 50;
  const retryIntervalMs = options.retryIntervalMs ?? 60_000;
  const stopsBatch = options.stopsBatch ?? outboxStopsBatch;
  const logger = options.logger ?? console;
  const { query } = options;

  if (!Number.isInteger(batchSize) || batchSize < 1)
    throw new Error('outbox: batchSize must be >= 1');

  const requeueClause = `
  on conflict (${key}) do update
     set version = nextval('${sequence}'),
         enqueued_at = now(),
         attempts = 0,
         last_error = null,
         last_attempt_at = null`;

  async function enqueue(
    q: OutboxQuery,
    entries: readonly OutboxEnqueueEntry[],
    enqueueOptions: { readonly onConflict?: 'requeue' | 'ignore' } = {},
  ): Promise<void> {
    if (entries.length === 0) return;
    const conflict =
      enqueueOptions.onConflict === 'ignore' ? `on conflict (${key}) do nothing` : requeueClause;
    // Ein Eintrag je Schluessel; der letzte gewinnt, wie bei einzelnen Aufrufen.
    const byKey = new Map<string, OutboxEnqueueEntry>();
    for (const entry of entries) byKey.set(entry.key, entry);
    const keys = [...byKey.keys()];
    if (payload === null) {
      await q(`insert into ${table} (${key}) select unnest($1::text[]) ${conflict}`, [keys]);
      return;
    }
    const payloads = [...byKey.values()].map((entry) =>
      entry.payload === undefined ? null : JSON.stringify(entry.payload),
    );
    await q(
      `insert into ${table} (${key}, ${payload})
       select k, p::jsonb from unnest($1::text[], $2::text[]) as t (k, p)
       ${conflict}`,
      [keys, payloads],
    );
  }

  async function pending(): Promise<number> {
    const rows = await query<{ n: number }>(`select count(*)::int as n from ${table}`);
    return Number(rows[0]?.n ?? 0);
  }

  async function deliverPending(limit: number = batchSize): Promise<OutboxDeliveryReport> {
    const batch = await query<{
      key: string;
      version: string;
      payload: unknown;
      attempts: number;
    }>(
      `select ${key}::text as key, version::text as version,
              ${payload === null ? 'null' : payload} as payload, attempts
         from ${table}
        order by attempts, version
        limit $1`,
      [limit],
    );
    let delivered = 0;
    let failed = 0;
    let stopped = false;
    let lastError: string | null = null;

    for (const entry of batch) {
      try {
        await options.deliver({
          key: entry.key,
          version: entry.version,
          payload: entry.payload ?? null,
          attempts: Number(entry.attempts),
        });
        // Nur diese Version. Ist inzwischen eine neuere da, bleibt sie stehen.
        await query(`delete from ${table} where ${key} = $1 and version = $2::bigint`, [
          entry.key,
          entry.version,
        ]);
        delivered += 1;
      } catch (error) {
        failed += 1;
        lastError = describeOutboxError(error);
        await query(
          `update ${table}
              set attempts = attempts + 1, last_error = $3, last_attempt_at = now()
            where ${key} = $1 and version = $2::bigint`,
          [entry.key, entry.version, lastError],
        );
        if (stopsBatch(error)) {
          stopped = true;
          break;
        }
      }
    }

    return { delivered, failed, pending: await pending(), stopped, lastError };
  }

  let running: Promise<void> | null = null;
  let again = false;
  let lastLoggedError: string | null = null;

  /** Derselbe Fehler steht nur einmal im Log, nicht bei jedem Takt. */
  function logOnce(message: string | null): void {
    if (message === null) {
      if (lastLoggedError !== null) logger.info(`${options.name}: delivering again`);
      lastLoggedError = null;
      return;
    }
    if (message === lastLoggedError) return;
    lastLoggedError = message;
    logger.warn(`${options.name}: ${message}`);
  }

  async function drain(): Promise<void> {
    try {
      do {
        again = false;
        let report: OutboxDeliveryReport;
        do {
          report = await deliverPending();
        } while (!report.stopped && report.delivered > 0 && report.pending > 0);
        logOnce(report.lastError);
        if (report.stopped) break;
      } while (again);
    } catch (error) {
      // Die Datenbank selbst ist weg. Der naechste Anstoss versucht es wieder.
      logOnce(describeOutboxError(error));
    }
  }

  function kick(): void {
    if (running !== null) {
      again = true;
      return;
    }
    running = drain().finally(() => {
      running = null;
    });
  }

  async function settle(): Promise<void> {
    while (running !== null) await running;
  }

  let timer: ReturnType<typeof setInterval> | null = null;

  function start(): void {
    kick();
    if (timer !== null) return;
    timer = setInterval(() => {
      void pending()
        .then((count) => {
          if (count > 0) kick();
        })
        .catch(() => undefined);
    }, retryIntervalMs);
    timer.unref?.();
  }

  function stop(): void {
    if (timer !== null) clearInterval(timer);
    timer = null;
  }

  async function status(limit = 10): Promise<OutboxStatus> {
    const [summary, errors] = await Promise.all([
      query<{ pending: number; failing: number; oldest: Date | null }>(
        `select count(*)::int as pending,
                count(*) filter (where attempts > 0)::int as failing,
                min(enqueued_at) as oldest
           from ${table}`,
      ),
      query<{
        key: string;
        attempts: number;
        last_error: string | null;
        last_attempt_at: Date | null;
      }>(
        `select ${key}::text as key, attempts, last_error, last_attempt_at from ${table}
          where attempts > 0
          order by attempts desc, last_attempt_at desc
          limit $1`,
        [limit],
      ),
    ]);
    const row = summary[0];
    return {
      pending: Number(row?.pending ?? 0),
      failing: Number(row?.failing ?? 0),
      oldestEnqueuedAt: row?.oldest?.toISOString() ?? null,
      errors: errors.map((entry) => ({
        key: entry.key,
        attempts: Number(entry.attempts),
        lastError: entry.last_error,
        lastAttemptAt: entry.last_attempt_at?.toISOString() ?? null,
      })),
    };
  }

  return { enqueue, requeueClause, deliverPending, pending, kick, settle, start, stop, status };
}
