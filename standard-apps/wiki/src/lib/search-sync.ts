import { AppCallError, callAppTool } from '@openapps/sdk';
import { query, transaction, type Tx } from './db';

/**
 * Das Wiki liefert seine Seiten an die gemeinsame Suche (Knowledge, ADR 0020).
 *
 * ## Der Weg
 *
 * 1. Jede Aenderung reiht die Seite **in derselben Transaktion** in
 *    `search_outbox` ein (`enqueuePages`, `enqueueSubtree`). Was gespeichert
 *    ist, steht damit auch in der Outbox — oder beides nicht.
 * 2. Nach dem Commit stoesst `kickSearchSync` die Lieferung an, ohne darauf zu
 *    warten. Speichern dauert dadurch nicht laenger und scheitert nie an
 *    Knowledge.
 * 3. `deliverPending` liest je Eintrag den **aktuellen** Stand der Seite und
 *    ruft `knowledge.documents.upsert` (oder `documents.remove`, wenn die
 *    Seite archiviert ist) ueber die Plattform. Geloescht wird der Eintrag nur
 *    mit der Version, die geliefert wurde: Eine Aenderung waehrend der
 *    Lieferung bekommt eine neue Version und bleibt stehen.
 * 4. Scheitert die Lieferung, bleibt der Eintrag mit `last_error`. Wiederholt
 *    wird beim naechsten Schreiben, beim Start und alle 60 s, solange etwas
 *    aussteht (`startSearchSync`).
 *
 * ## Kein Rechte-Code
 *
 * Ob das Wiki an Knowledge liefern darf, entscheidet die Plattform (Freigabe
 * `execute` fuer `app:wiki` auf `knowledge.documents.upsert` und
 * `knowledge.documents.remove`). Fehlt sie, antwortet die Plattform 403, und
 * der Eintrag wartet. Wer die Treffer sehen darf, entscheidet Knowledge mit der
 * Liste der lesbaren Apps — das Wiki liefert alles ab.
 */

/** Hoechstlaengen in Knowledge (`schemas.ts` dort). */
const KNOWLEDGE_CONTENT_MAX = 200_000;
const KNOWLEDGE_SOURCE_MAX = 500;
const KNOWLEDGE_TITLE_MAX = 200;
const LAST_ERROR_MAX = 1000;

/** Eintraege je Durchlauf. Der Rest kommt im naechsten. */
const BATCH_SIZE = 50;

/** So oft wird nachgesehen, ob noch etwas aussteht. */
const RETRY_INTERVAL_MS = 60_000;

export interface Deliverer {
  upsert(args: UpsertPayload): Promise<unknown>;
  remove(args: { key: string }): Promise<unknown>;
}

export interface UpsertPayload {
  key: string;
  title: string;
  content: string;
  source: string;
  path: string;
  updatedAt: string;
}

/** Der Normalweg: ueber die Plattform an Knowledge (`callAppTool` aus dem SDK). */
export const platformDeliverer: Deliverer = {
  upsert: (args) => callAppTool('knowledge', 'documents.upsert', { ...args }),
  remove: (args) => callAppTool('knowledge', 'documents.remove', { ...args }),
};

let deliverer: Deliverer = platformDeliverer;

/** Fuer Tests: einen anderen Lieferweg einsetzen. `undefined` stellt den Normalweg her. */
export function setSearchDeliverer(replacement: Deliverer | undefined): void {
  deliverer = replacement ?? platformDeliverer;
}

/* -------------------------------------------------------------------------- */
/* Einreihen — immer in der Transaktion der Aenderung                          */
/* -------------------------------------------------------------------------- */

const ENQUEUE_CONFLICT = `
  on conflict (page_id) do update
     set version = nextval('search_outbox_version_seq'),
         enqueued_at = now(),
         attempts = 0,
         last_error = null,
         last_attempt_at = null`;

/** Reiht Seiten ein. Nur innerhalb der Transaktion der Aenderung aufrufen. */
export async function enqueuePages(tx: Tx, pageIds: readonly string[]): Promise<void> {
  if (pageIds.length === 0) return;
  await tx.query(
    `insert into search_outbox (page_id)
     select distinct unnest($1::uuid[])
     ${ENQUEUE_CONFLICT}`,
    [[...pageIds]],
  );
}

/**
 * Reiht eine Seite und alle ihre Unterseiten ein: Nach einer Umbenennung oder
 * einem Verschieben aendert sich der Pfad jeder Unterseite, und der steht in
 * Knowledge als Herkunft am Treffer. Kreisfest wie `ancestors` in `pages.ts`.
 */
export async function enqueueSubtree(tx: Tx, pageId: string): Promise<void> {
  await tx.query(
    `with recursive t (id, seen) as (
       select $1::uuid, array[$1::uuid]
       union all
       select p.id, t.seen || p.id
         from pages p
         join t on p.parent_id = t.id
        where not p.id = any (t.seen)
     )
     insert into search_outbox (page_id)
     select distinct id from t
     ${ENQUEUE_CONFLICT}`,
    [pageId],
  );
}

/** Reiht alle Seiten ein und merkt sich, dass es geschehen ist. Gibt die Zahl zurueck. */
async function enqueueAll(tx: Tx): Promise<number> {
  const rows = await tx.query<{ n: number }>(
    `with queued as (
       insert into search_outbox (page_id)
       select id from pages
       ${ENQUEUE_CONFLICT}
       returning 1
     )
     select count(*)::int as n from queued`,
  );
  await tx.query(
    `insert into search_sync (id, backfilled_at) values (true, now())
     on conflict (id) do update set backfilled_at = now()`,
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * Beim ersten Start mit 0.3.0: alle Seiten einmal einreihen. Danach nie
 * wieder von selbst — dafuer gibt es `search.backfill`. Zwei Instanzen, die
 * gleichzeitig starten, reihen nur einmal ein (Zeilensperre auf `search_sync`).
 */
export async function backfillIfFirstRun(): Promise<number | null> {
  return transaction(async (tx) => {
    await tx.query('insert into search_sync (id) values (true) on conflict (id) do nothing');
    const rows = await tx.query<{ backfilled_at: Date | null }>(
      'select backfilled_at from search_sync where id for update',
    );
    if (rows[0]?.backfilled_at !== null && rows[0]?.backfilled_at !== undefined) return null;
    return enqueueAll(tx);
  });
}

/* -------------------------------------------------------------------------- */
/* Liefern                                                                     */
/* -------------------------------------------------------------------------- */

interface OutboxRow extends Record<string, unknown> {
  page_id: string;
  version: string;
}

interface PageStateRow extends Record<string, unknown> {
  id: string;
  title: string;
  content_md: string;
  archived_at: Date | null;
  updated_at: Date;
}

export interface DeliveryReport {
  delivered: number;
  failed: number;
  /** Was nach diesem Durchlauf noch aussteht. */
  pending: number;
  /** Abgebrochen, weil die Plattform oder Knowledge gerade nicht annimmt. */
  stopped: boolean;
  lastError: string | null;
}

/** Text fuer Knowledge: Titel als erste Zeile, damit er mitgesucht wird, dann der Inhalt. */
export function knowledgeContent(title: string, contentMd: string): string {
  const content = contentMd.trim() === '' ? title : `${title}\n\n${contentMd}`;
  return content.length > KNOWLEDGE_CONTENT_MAX ? content.slice(0, KNOWLEDGE_CONTENT_MAX) : content;
}

/** Die Herkunft am Treffer: der Pfad der Seite im Wiki, etwa „Wiki › Handbuch › Onboarding“. */
export function knowledgeSource(path: readonly string[]): string {
  const label = ['Wiki', ...path].join(' › ');
  return label.length > KNOWLEDGE_SOURCE_MAX ? `${label.slice(0, KNOWLEDGE_SOURCE_MAX - 1)}…` : label;
}

/** Titel der Vorfahren und der Seite selbst, oberste zuerst. */
async function titlePath(pageId: string): Promise<string[]> {
  const rows = await query<{ title: string }>(
    `with recursive up (id, parent_id, title, depth, seen) as (
       select id, parent_id, title, 0, array[id] from pages where id = $1
       union all
       select p.id, p.parent_id, p.title, up.depth + 1, up.seen || p.id
         from pages p
         join up on p.id = up.parent_id
        where not p.id = any (up.seen)
     )
     select title from up order by depth desc`,
    [pageId],
  );
  return rows.map((row) => row.title);
}

/** Liefert eine Seite in ihrem aktuellen Stand. Wirft, wenn die Lieferung scheitert. */
async function deliverPage(pageId: string): Promise<void> {
  const rows = await query<PageStateRow>(
    'select id, title, content_md, archived_at, updated_at from pages where id = $1',
    [pageId],
  );
  const page = rows[0];
  if (page === undefined || page.archived_at !== null) {
    await deliverer.remove({ key: pageId });
    return;
  }
  const title =
    page.title.length > KNOWLEDGE_TITLE_MAX ? page.title.slice(0, KNOWLEDGE_TITLE_MAX) : page.title;
  await deliverer.upsert({
    key: page.id,
    title,
    content: knowledgeContent(page.title, page.content_md),
    source: knowledgeSource(await titlePath(page.id)),
    path: `/pages/${page.id}`,
    updatedAt: page.updated_at.toISOString(),
  });
}

/**
 * Lohnt es, mit dem naechsten Eintrag weiterzumachen? Nein, wenn die
 * Plattform oder Knowledge gerade gar nicht annimmt (nicht erreichbar,
 * keine Freigabe, nicht konfiguriert): Der naechste Eintrag scheiterte genauso.
 * Ja bei einem Fehler, der an diesem Eintrag haengt (falsche Argumente).
 */
function stopsTheBatch(error: unknown): boolean {
  if (!(error instanceof AppCallError)) return true;
  return error.code !== 'invalid' && error.code !== 'not_found';
}

function describeError(error: unknown): string {
  // AppCallError-Meldungen enthalten nie ein Secret (SDK). Alles andere wird
  // nur mit seinem Namen notiert, nicht mit seiner Meldung.
  const text =
    error instanceof AppCallError
      ? `${error.code}: ${error.message}`
      : error instanceof Error
        ? `${error.name}: delivery failed`
        : 'delivery failed';
  return text.slice(0, LAST_ERROR_MAX);
}

/** Ein Durchlauf ueber hoechstens `limit` Eintraege, die mit den wenigsten Fehlversuchen zuerst. */
export async function deliverPending(limit: number = BATCH_SIZE): Promise<DeliveryReport> {
  const batch = await query<OutboxRow>(
    `select page_id, version::text as version from search_outbox
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
      await deliverPage(entry.page_id);
      // Nur diese Version. Ist inzwischen eine neuere da, bleibt sie stehen.
      await query('delete from search_outbox where page_id = $1 and version = $2::bigint', [
        entry.page_id,
        entry.version,
      ]);
      delivered += 1;
    } catch (error) {
      failed += 1;
      lastError = describeError(error);
      await query(
        `update search_outbox
            set attempts = attempts + 1, last_error = $3, last_attempt_at = now()
          where page_id = $1 and version = $2::bigint`,
        [entry.page_id, entry.version, lastError],
      );
      if (stopsTheBatch(error)) {
        stopped = true;
        break;
      }
    }
  }

  return { delivered, failed, pending: await pendingCount(), stopped, lastError };
}

async function pendingCount(): Promise<number> {
  const rows = await query<{ n: number }>('select count(*)::int as n from search_outbox');
  return Number(rows[0]?.n ?? 0);
}

/* -------------------------------------------------------------------------- */
/* Anstossen — nach dem Commit, beim Start, im Takt                            */
/* -------------------------------------------------------------------------- */

let running: Promise<void> | null = null;
let again = false;
let lastLoggedError: string | null = null;

/**
 * Stoesst die Lieferung an und kehrt sofort zurueck. Wirft nie. Laeuft schon
 * eine, wird danach noch einmal geliefert — nichts, was waehrend einer
 * Lieferung eingereiht wird, bleibt bis zum naechsten Takt liegen.
 */
export function kickSearchSync(): void {
  if (running !== null) {
    again = true;
    return;
  }
  running = drain().finally(() => {
    running = null;
  });
}

/** Fuer Tests und das Tool `search.backfill`: auf eine laufende Lieferung warten. */
export async function settleSearchSync(): Promise<void> {
  while (running !== null) await running;
}

async function drain(): Promise<void> {
  try {
    do {
      again = false;
      let report: DeliveryReport;
      do {
        report = await deliverPending();
      } while (!report.stopped && report.delivered > 0 && report.pending > 0);
      logOnce(report.lastError);
      if (report.stopped) break;
    } while (again);
  } catch (error) {
    // Die Datenbank selbst ist weg. Der naechste Anstoss versucht es wieder.
    logOnce(describeError(error));
  }
}

/** Derselbe Fehler steht nur einmal im Log, nicht bei jedem Takt. */
function logOnce(message: string | null): void {
  if (message === null) {
    if (lastLoggedError !== null) console.info('[wiki] search sync: delivering again');
    lastLoggedError = null;
    return;
  }
  if (message === lastLoggedError) return;
  lastLoggedError = message;
  console.warn(`[wiki] search sync: ${message}`);
}

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Beim Start: beim ersten Mal alle Seiten einreihen, dann liefern, dann alle
 * 60 s nachsehen. Scheitert etwas, startet die App trotzdem — die Suche ist
 * Zugabe, nicht Voraussetzung.
 */
export async function startSearchSync(): Promise<void> {
  try {
    const queued = await backfillIfFirstRun();
    if (queued !== null) console.info(`[wiki] search sync: ${String(queued)} page(s) queued`);
  } catch (error) {
    console.warn(`[wiki] search sync: first run backfill failed (${describeError(error)})`);
  }
  kickSearchSync();
  if (timer === null) {
    timer = setInterval(() => {
      void pendingCount()
        .then((pending) => {
          if (pending > 0) kickSearchSync();
        })
        .catch(() => undefined);
    }, RETRY_INTERVAL_MS);
    timer.unref();
  }
}

/* -------------------------------------------------------------------------- */
/* Tools                                                                       */
/* -------------------------------------------------------------------------- */

export interface BackfillResult extends DeliveryReport {
  queued: number;
}

/** Zeitbudget fuer `search.backfill`; was dann noch aussteht, laeuft im Hintergrund weiter. */
const BACKFILL_BUDGET_MS = 20_000;

/**
 * `search.backfill`: alle Seiten neu einreihen und so viele liefern, wie in
 * das Zeitbudget passen. Der Rest wird im Hintergrund geliefert.
 */
export async function backfillSearch(): Promise<BackfillResult> {
  const queued = await transaction((tx) => enqueueAll(tx));
  await settleSearchSync();
  const started = Date.now();
  const total: DeliveryReport = { delivered: 0, failed: 0, pending: queued, stopped: false, lastError: null };
  while (Date.now() - started < BACKFILL_BUDGET_MS) {
    const report = await deliverPending();
    total.delivered += report.delivered;
    total.failed += report.failed;
    total.pending = report.pending;
    total.stopped = report.stopped;
    total.lastError = report.lastError ?? total.lastError;
    if (report.stopped || report.pending === 0 || report.delivered + report.failed === 0) break;
  }
  if (total.pending > 0 && !total.stopped) kickSearchSync();
  return { queued, ...total };
}

export interface SearchSyncStatus {
  pending: number;
  failing: number;
  backfilledAt: string | null;
  oldestEnqueuedAt: string | null;
  /** Die Eintraege mit den meisten Fehlversuchen, hoechstens 10. */
  errors: { pageId: string; attempts: number; lastError: string | null; lastAttemptAt: string | null }[];
}

/** `search.status`: was aussteht und warum. */
export async function searchSyncStatus(): Promise<SearchSyncStatus> {
  const [summary, sync, errors] = await Promise.all([
    query<{ pending: number; failing: number; oldest: Date | null }>(
      `select count(*)::int as pending,
              count(*) filter (where attempts > 0)::int as failing,
              min(enqueued_at) as oldest
         from search_outbox`,
    ),
    query<{ backfilled_at: Date | null }>('select backfilled_at from search_sync where id'),
    query<{ page_id: string; attempts: number; last_error: string | null; last_attempt_at: Date | null }>(
      `select page_id, attempts, last_error, last_attempt_at from search_outbox
        where attempts > 0
        order by attempts desc, last_attempt_at desc
        limit 10`,
    ),
  ]);
  const row = summary[0];
  return {
    pending: Number(row?.pending ?? 0),
    failing: Number(row?.failing ?? 0),
    backfilledAt: sync[0]?.backfilled_at?.toISOString() ?? null,
    oldestEnqueuedAt: row?.oldest?.toISOString() ?? null,
    errors: errors.map((entry) => ({
      pageId: entry.page_id,
      attempts: Number(entry.attempts),
      lastError: entry.last_error,
      lastAttemptAt: entry.last_attempt_at?.toISOString() ?? null,
    })),
  };
}
