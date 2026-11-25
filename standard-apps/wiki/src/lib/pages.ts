import { ToolInputError, ToolNotFoundError } from '@openapps/sdk';
import { query, transaction, type Tx } from './db';
import {
  LIMITS,
  type PagesArchiveArgs,
  type PagesCreateArgs,
  type PagesGetArgs,
  type PagesHistoryArgs,
  type PagesListArgs,
  type PagesSearchArgs,
  type PagesUpdateArgs,
} from './schemas';

/**
 * Datenzugriff des Wikis. Jede Funktion hier ist genau ein Tool; die UI ruft
 * dieselben Funktionen. Rechte werden hier nicht geprueft — das hat das
 * Gateway bzw. der Plattform-MCP vor dem Aufruf getan. `actor` ist nur fuer
 * `created_by`/`updated_by` und den Verlauf da.
 */

export interface PageRef {
  id: string;
  title: string;
}

export interface PageSummary {
  id: string;
  parentId: string | null;
  title: string;
  tags: string[];
  updatedAt: string;
  updatedBy: string;
}

export interface Page extends PageSummary {
  contentMd: string;
  createdAt: string;
  createdBy: string;
  archivedAt: string | null;
  parent: PageRef | null;
  children: PageRef[];
}

export interface SearchHit {
  id: string;
  parentId: string | null;
  title: string;
  tags: string[];
  updatedAt: string;
  rank: number;
  /** Ausschnitt um die Treffer, Treffer in `«` und `»` eingefasst, eine Zeile. */
  snippet: string;
}

export type RevisionChange = 'create' | 'update' | 'archive';

export interface Revision {
  id: string;
  change: RevisionChange;
  title: string;
  contentMd: string;
  tags: string[];
  editedBy: string;
  editedAt: string;
}

interface SummaryRow extends Record<string, unknown> {
  id: string;
  parent_id: string | null;
  title: string;
  tags: string[];
  updated_at: Date;
  updated_by: string;
}

interface PageRow extends SummaryRow {
  content_md: string;
  created_at: Date;
  created_by: string;
  archived_at: Date | null;
}

interface RefRow extends Record<string, unknown> {
  id: string;
  title: string;
}

const PAGE_COLUMNS =
  'id, parent_id, title, content_md, tags, created_by, updated_by, created_at, updated_at, archived_at';

const toSummary = (row: SummaryRow): PageSummary => ({
  id: row.id,
  parentId: row.parent_id,
  title: row.title,
  tags: row.tags,
  updatedAt: row.updated_at.toISOString(),
  updatedBy: row.updated_by,
});

/** `%` und `_` sind in ILIKE Platzhalter; ein Suchtext meint sie woertlich. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Haengt Markdown an bestehenden Inhalt an: getrennt durch eine Leerzeile,
 * damit der angehaengte Text ein eigener Block wird und nicht in den letzten
 * Absatz hineinlaeuft.
 */
export function appendMarkdown(existing: string, addition: string): string {
  const head = existing.replace(/\s+$/, '');
  const tail = addition.replace(/^\s*\n/, '');
  return head === '' ? tail : `${head}\n\n${tail}`;
}

export interface PageList {
  pages: PageSummary[];
  /** Mehr Treffer als `LIMITS.listMax`: Filter enger stellen. */
  truncated: boolean;
}

/** pages.list */
export async function listPages(args: PagesListArgs): Promise<PageList> {
  const q = args.q === undefined || args.q === '' ? null : `%${escapeLike(args.q)}%`;
  const rows = await query<SummaryRow>(
    `select id, parent_id, title, tags, updated_at, updated_by
       from pages
      where archived_at is null
        and ($1::text is null or title ilike $1)
        and ($2::uuid is null or parent_id = $2::uuid)
        and ($3::text is null or tags @> array[$3::text])
      order by lower(title), id
      limit $4`,
    [q, args.parentId ?? null, args.tag ?? null, LIMITS.listMax + 1],
  );
  return {
    pages: rows.slice(0, LIMITS.listMax).map(toSummary),
    truncated: rows.length > LIMITS.listMax,
  };
}

/** Liest eine Seite samt Eltern und Unterseiten. Archivierte Seiten auch. */
async function readPage(run: Tx['query'], id: string): Promise<Page> {
  const rows = await run<PageRow>(`select ${PAGE_COLUMNS} from pages where id = $1`, [id]);
  const row = rows[0];
  if (row === undefined) throw new ToolNotFoundError(`Page ${id} does not exist`);

  const [parentRows, childRows] = await Promise.all([
    row.parent_id === null
      ? Promise.resolve([])
      : run<RefRow>('select id, title from pages where id = $1', [row.parent_id]),
    run<RefRow>(
      `select id, title from pages
        where parent_id = $1 and archived_at is null
        order by lower(title), id`,
      [id],
    ),
  ]);
  const parent = parentRows[0];

  return {
    ...toSummary(row),
    contentMd: row.content_md,
    createdAt: row.created_at.toISOString(),
    createdBy: row.created_by,
    archivedAt: row.archived_at === null ? null : row.archived_at.toISOString(),
    parent: parent === undefined ? null : { id: parent.id, title: parent.title },
    children: childRows.map((child) => ({ id: child.id, title: child.title })),
  };
}

/** pages.get */
export async function getPage(args: PagesGetArgs): Promise<Page> {
  return readPage(query, args.id);
}

interface SearchRow extends Record<string, unknown> {
  id: string;
  parent_id: string | null;
  title: string;
  tags: string[];
  updated_at: Date;
  rank: number;
  snippet: string;
}

/**
 * pages.search — Volltext ueber Titel und Inhalt, englische Stammformen.
 * Die Konfiguration 'english' muss zur Spalte `search` passen
 * (migrations/0002_english_search.sql).
 *
 * Treffer im Ausschnitt stehen in `«…»`, nicht in `**`: Der Inhalt ist selbst
 * Markdown, und `**` darin waere von einer Treffermarke nicht zu unterscheiden.
 */
export async function searchPages(args: PagesSearchArgs): Promise<{ hits: SearchHit[] }> {
  const rows = await query<SearchRow>(
    `select p.id, p.parent_id, p.title, p.tags, p.updated_at,
            ts_rank(p.search, q)::float8 as rank,
            ts_headline('english', p.title || ' ' || p.content_md, q,
              'StartSel=«, StopSel=», MaxWords=35, MinWords=12, MaxFragments=2, FragmentDelimiter=" … "') as snippet
       from pages p, websearch_to_tsquery('english', $1) q
      where p.archived_at is null
        and p.search @@ q
      order by rank desc, p.updated_at desc
      limit $2`,
    [args.query, args.limit],
  );
  return {
    hits: rows.map((row) => ({
      id: row.id,
      parentId: row.parent_id,
      title: row.title,
      tags: row.tags,
      updatedAt: row.updated_at.toISOString(),
      rank: Number(row.rank),
      snippet: row.snippet.replace(/\s+/g, ' ').trim(),
    })),
  };
}

async function writeRevision(
  tx: Tx,
  pageId: string,
  change: RevisionChange,
  actor: string,
): Promise<void> {
  await tx.query(
    `insert into page_revisions (page_id, change, title, content_md, tags, edited_by, edited_at)
     select id, $2, title, content_md, tags, $3, updated_at from pages where id = $1`,
    [pageId, change, actor],
  );
}

/** Sperrt eine Seite fuer den Rest der Transaktion. Wirft, wenn es sie nicht gibt. */
async function lockPage(tx: Tx, id: string): Promise<PageRow> {
  const rows = await tx.query<PageRow>(`select ${PAGE_COLUMNS} from pages where id = $1 for update`, [
    id,
  ]);
  const row = rows[0];
  if (row === undefined) throw new ToolNotFoundError(`Page ${id} does not exist`);
  return row;
}

/** pages.create */
export async function createPage(args: PagesCreateArgs, actor: string): Promise<Page> {
  const id = await transaction(async (tx) => {
    if (args.parentId !== undefined) {
      // Die Sperre auf der Elternseite haelt ein gleichzeitiges Archivieren an,
      // bis die neue Unterseite steht — sonst haette eine archivierte Seite
      // eine lebende Unterseite.
      const parent = await lockPage(tx, args.parentId).catch((error: unknown) => {
        if (error instanceof ToolNotFoundError) {
          throw new ToolNotFoundError(`Parent page ${args.parentId} does not exist`);
        }
        throw error;
      });
      if (parent.archived_at !== null) {
        throw new ToolInputError(`Parent page ${args.parentId} is archived`);
      }
    }
    const rows = await tx.query<{ id: string }>(
      `insert into pages (parent_id, title, content_md, tags, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $5)
       returning id`,
      [args.parentId ?? null, args.title, args.contentMd, args.tags, actor],
    );
    const created = rows[0];
    if (created === undefined) throw new Error('insert returned no row');
    await writeRevision(tx, created.id, 'create', actor);
    return created.id;
  });
  return getPage({ id });
}

const sameTags = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((tag, index) => tag === b[index]);

/** pages.update — ersetzt oder haengt an, schreibt eine Revision. */
export async function updatePage(args: PagesUpdateArgs, actor: string): Promise<Page> {
  await transaction(async (tx) => {
    const current = await lockPage(tx, args.id);
    if (current.archived_at !== null) {
      throw new ToolInputError(`Page ${args.id} is archived and cannot be edited`);
    }

    const title = args.title ?? current.title;
    const tags = args.tags ?? current.tags;
    const contentMd =
      args.appendMd !== undefined
        ? appendMarkdown(current.content_md, args.appendMd)
        : (args.contentMd ?? current.content_md);

    if (contentMd.length > LIMITS.contentMax) {
      throw new ToolInputError(
        `Content would be ${contentMd.length} characters long after the change; the limit is ${LIMITS.contentMax}`,
      );
    }

    // Nichts geaendert: keine leere Revision, die den Verlauf verrauscht.
    if (title === current.title && contentMd === current.content_md && sameTags(tags, current.tags)) {
      return;
    }

    await tx.query(
      `update pages
          set title = $2, content_md = $3, tags = $4, updated_by = $5, updated_at = now()
        where id = $1`,
      [args.id, title, contentMd, tags, actor],
    );
    await writeRevision(tx, args.id, 'update', actor);
  });
  return getPage({ id: args.id });
}

export interface ArchiveResult {
  id: string;
  archivedAt: string;
}

/**
 * pages.archive — eine Seite verschwindet aus Liste und Suche, bleibt aber mit
 * Verlauf lesbar. Eine Seite mit lebenden Unterseiten wird nicht archiviert:
 * sonst haengen diese ohne Eltern im Baum.
 */
export async function archivePage(args: PagesArchiveArgs, actor: string): Promise<ArchiveResult> {
  return transaction(async (tx) => {
    const current = await lockPage(tx, args.id);
    if (current.archived_at !== null) {
      return { id: current.id, archivedAt: current.archived_at.toISOString() };
    }

    const children = await tx.query<RefRow>(
      `select id, title from pages
        where parent_id = $1 and archived_at is null
        order by lower(title), id
        limit 6`,
      [args.id],
    );
    if (children.length > 0) {
      const names = children
        .slice(0, 5)
        .map((child) => `"${child.title}" (${child.id})`)
        .join(', ');
      throw new ToolInputError(
        `Page still has subpages: ${names}${children.length > 5 ? ', …' : ''}. Archive the subpages first.`,
      );
    }

    const rows = await tx.query<{ archived_at: Date }>(
      `update pages
          set archived_at = now(), updated_at = now(), updated_by = $2
        where id = $1
        returning archived_at`,
      [args.id, actor],
    );
    const row = rows[0];
    if (row === undefined) throw new Error('update returned no row');
    await writeRevision(tx, args.id, 'archive', actor);
    return { id: args.id, archivedAt: row.archived_at.toISOString() };
  });
}

interface RevisionRow extends Record<string, unknown> {
  id: string;
  change: RevisionChange;
  title: string;
  content_md: string;
  tags: string[];
  edited_by: string;
  edited_at: Date;
}

/** pages.history — neueste Aenderung zuerst. */
export async function pageHistory(
  args: PagesHistoryArgs,
): Promise<{ pageId: string; title: string; revisions: Revision[] }> {
  const pages = await query<RefRow>('select id, title from pages where id = $1', [args.id]);
  const page = pages[0];
  if (page === undefined) throw new ToolNotFoundError(`Page ${args.id} does not exist`);

  const rows = await query<RevisionRow>(
    `select id::text as id, change, title, content_md, tags, edited_by, edited_at
       from page_revisions
      where page_id = $1
      order by edited_at desc, id desc
      limit $2`,
    [args.id, args.limit],
  );
  return {
    pageId: page.id,
    title: page.title,
    revisions: rows.map((row) => ({
      id: row.id,
      change: row.change,
      title: row.title,
      contentMd: row.content_md,
      tags: row.tags,
      editedBy: row.edited_by,
      editedAt: row.edited_at.toISOString(),
    })),
  };
}
