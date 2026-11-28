import {
  actorOf,
  createRefsOutbox,
  ownRef,
  parseResolveArgs,
  REFS_LIMITS,
  type ResolveToolResult,
  type SetRefsInput,
} from '@openapps/sdk';
import { query, type Tx } from './db';
import { extractRefTokens } from './markdown';

/**
 * Verweise zwischen Apps (ADR 0023), die Seite des Wikis:
 *
 * - **Resolver** `pages.resolve` fuer `page` (Manifest unter `objects`):
 *   Titel, Pfad und „Archived“ fuer archivierte Seiten. Die Plattform ruft
 *   ihn erst, nachdem sie geprueft hat, dass der Betrachter das Wiki lesen
 *   darf; hier steht kein Rechte-Code.
 * - **Ausgehende Verweise** einer Seite: die `@{…}` im Inhalt, ausserhalb
 *   von Code. Gemeldet wird immer die ganze Menge, ueber die Outbox in
 *   derselben Transaktion wie die Aenderung; eine archivierte Seite meldet
 *   die leere Menge. Wer erwaehnt wird und die Seite lesen darf, bekommt von
 *   der Plattform eine Erwaehnung im Eingang.
 */

export const wikiRefs = createRefsOutbox({
  query: (sql, params) => query(sql, params),
  name: '[wiki] refs',
});

/** Nach dem Commit: liefern, ohne zu warten. Wirft nie. */
export function kickRefs(): void {
  wikiRefs.kick();
}

/** Der Verweis auf eine eigene Seite. */
export const pageRef = (id: string): string => ownRef('wiki', 'page', id).ref;

/** Die Meldung fuer eine Seite, aus ihrem Stand. Rein, fuer Tests. */
export function pageRefsReport(page: {
  id: string;
  title: string;
  contentMd: string;
  archived: boolean;
  updatedAt: Date;
  actor: string | null;
}): SetRefsInput {
  return {
    source: pageRef(page.id),
    targets: page.archived ? [] : extractRefTokens(page.contentMd, REFS_LIMITS.targets),
    updatedAt: page.updatedAt,
    title: page.title,
    path: `/pages/${encodeURIComponent(page.id)}`,
    actor: actorOf(page.actor),
  };
}

/** Reiht die Verweise der Seite ein. Nur in der Transaktion der Aenderung. */
export async function reportPageRefs(tx: Tx, pageId: string, actor: string): Promise<void> {
  const [page] = await tx.query<{
    id: string;
    title: string;
    content_md: string;
    archived_at: Date | null;
    updated_at: Date;
  }>('select id, title, content_md, archived_at, updated_at from pages where id = $1', [pageId]);
  if (page === undefined) return;
  await wikiRefs.report(
    (sql, params) => tx.query(sql, params),
    pageRefsReport({
      id: page.id,
      title: page.title,
      contentMd: page.content_md,
      archived: page.archived_at !== null,
      updatedAt: page.updated_at,
      actor,
    }),
  );
}

/** Hat der Inhalt Verweise? Dann lohnt eine Meldung auch beim Anlegen. */
export function hasRefTokens(contentMd: string): boolean {
  return extractRefTokens(contentMd, 1).length > 0;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `pages.resolve`: Titel, Pfad und Status fuer die Chips anderer Apps. */
export async function resolvePages(args: unknown): Promise<ResolveToolResult> {
  const { ids } = parseResolveArgs(args, ['page']);
  const valid = ids.filter((id) => UUID.test(id));
  if (valid.length === 0) return { objects: [] };
  const rows = await query<{ id: string; title: string; archived_at: Date | null; updated_at: Date }>(
    'select id::text as id, title, archived_at, updated_at from pages where id = any ($1::uuid[])',
    [valid],
  );
  return {
    objects: rows.map((row) => ({
      id: row.id,
      title: row.title,
      path: `/pages/${encodeURIComponent(row.id)}`,
      ...(row.archived_at === null ? {} : { status: 'Archived' }),
      updatedAt: row.updated_at.toISOString(),
    })),
  };
}
