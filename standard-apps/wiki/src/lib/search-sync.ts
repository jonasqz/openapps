import { callAppTool, createOutbox, type OutboxDeliveryReport } from '@openapps/sdk';
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
 * Die Schleife aus 3. und 4. (Stapel, Versionen, Abbruch, Takt, Log) ist seit
 * 0.4.0 `createOutbox` aus dem SDK (ADR 0022: zweiter Nutzer sind die
 * Ereignisse). Was hier bleibt, ist das, was nur das Wiki weiss: welche
 * Seiten eingereiht werden und was an Knowledge geht.
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

/**
 * Die Lieferung an Knowledge. `search_outbox` ist eine Outbox nach dem Muster
 * des SDK, mit `page_id` (uuid) als Schluessel und ohne `payload`: geliefert
 * wird immer der aktuelle Stand der Seite, nicht ein Schnappschuss.
 */
const outbox = createOutbox({
  name: '[wiki] search sync',
  table: 'search_outbox',
  keyColumn: 'page_id',
  payloadColumn: null,
  versionSequence: 'search_outbox_version_seq',
  query,
  deliver: (entry) => deliverPage(entry.key),
});

const ENQUEUE_CONFLICT = outbox.requeueClause;

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

interface PageStateRow extends Record<string, unknown> {
  id: string;
  title: string;
  content_md: string;
  archived_at: Date | null;
  updated_at: Date;
}

/** Ergebnis eines Durchlaufs; `stopped`: Plattform oder Knowledge nehmen gerade nicht an. */
export type DeliveryReport = OutboxDeliveryReport;

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

/** Ein Durchlauf ueber hoechstens `limit` Eintraege, die mit den wenigsten Fehlversuchen zuerst. */
export function deliverPending(limit?: number): Promise<DeliveryReport> {
  return outbox.deliverPending(limit);
}

/* -------------------------------------------------------------------------- */
/* Anstossen — nach dem Commit, beim Start, im Takt                            */
/* -------------------------------------------------------------------------- */

/**
 * Stoesst die Lieferung an und kehrt sofort zurueck. Wirft nie. Laeuft schon
 * eine, wird danach noch einmal geliefert — nichts, was waehrend einer
 * Lieferung eingereiht wird, bleibt bis zum naechsten Takt liegen.
 */
export function kickSearchSync(): void {
  outbox.kick();
}

/** Fuer Tests und das Tool `search.backfill`: auf eine laufende Lieferung warten. */
export function settleSearchSync(): Promise<void> {
  return outbox.settle();
}

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
    const name = error instanceof Error ? error.name : 'error';
    console.warn(`[wiki] search sync: first run backfill failed (${name})`);
  }
  outbox.start();
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
  const [status, sync] = await Promise.all([
    outbox.status(10),
    query<{ backfilled_at: Date | null }>('select backfilled_at from search_sync where id'),
  ]);
  return {
    pending: status.pending,
    failing: status.failing,
    backfilledAt: sync[0]?.backfilled_at?.toISOString() ?? null,
    oldestEnqueuedAt: status.oldestEnqueuedAt,
    errors: status.errors.map((entry) => ({
      pageId: entry.key,
      attempts: entry.attempts,
      lastError: entry.lastError,
      lastAttemptAt: entry.lastAttemptAt,
    })),
  };
}
