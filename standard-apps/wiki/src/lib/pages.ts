import { ToolInputError, ToolNotFoundError } from '@openapps/sdk';
import { query, transaction, type Tx } from './db';
import { extractPageLinks } from './markdown';
import { moveProblem } from './move';
import { enqueuePages, enqueueSubtree, kickSearchSync } from './search-sync';
import {
  LIMITS,
  type FavoritesSetArgs,
  type PagesArchiveArgs,
  type PagesCreateArgs,
  type PagesGetArgs,
  type PagesHistoryArgs,
  type PagesListArgs,
  type PagesMoveArgs,
  type PagesRestoreArgs,
  type PagesSearchArgs,
  type PagesTreeArgs,
  type PagesUpdateArgs,
} from './schemas';
import { buildTree, type TreeNode } from './tree';

/**
 * Datenzugriff des Wikis. Jede Funktion hier ist genau ein Tool; die UI ruft
 * dieselben Funktionen. Rechte werden hier nicht geprueft — das hat das
 * Gateway bzw. der Plattform-MCP vor dem Aufruf getan. `actor` ist nur fuer
 * `created_by`/`updated_by` und den Verlauf da.
 *
 * Jede schreibende Funktion reiht die geaenderten Seiten in derselben
 * Transaktion fuer die gemeinsame Suche ein und stoesst die Lieferung nach dem
 * Commit an (`search-sync.ts`, ADR 0020). Die Lieferung kann das Speichern
 * nicht scheitern lassen: Sie laeuft danach und wirft nie.
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
  /** Vorfahren von der obersten Seite bis zur Elternseite, fuer Breadcrumbs. */
  path: PageRef[];
  /** Nicht archivierte Seiten, die auf diese Seite verlinken. */
  backlinks: PageRef[];
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

export type RevisionChange = 'create' | 'update' | 'archive' | 'move' | 'restore';

export interface Revision {
  id: string;
  change: RevisionChange;
  /** Elternseite nach der Aenderung; `null` heisst oberste Ebene. */
  parentId: string | null;
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

/**
 * Sortierungen von pages.list. Feste Ausdruecke statt Text aus der Anfrage —
 * nichts vom Aufrufer landet im SQL ausser als Parameter.
 */
const LIST_ORDER = {
  title: 'lower(title), id',
  updated: 'updated_at desc, id',
} as const;

/** pages.list — nach Titel oder zuletzt geaendert („Recently edited“). */
export async function listPages(args: PagesListArgs): Promise<PageList> {
  const q = args.q === undefined || args.q === '' ? null : `%${escapeLike(args.q)}%`;
  const limit = args.limit ?? LIMITS.listMax;
  const order = LIST_ORDER[args.sort ?? 'title'];
  const rows = await query<SummaryRow>(
    `select id, parent_id, title, tags, updated_at, updated_by
       from pages
      where archived_at is null
        and ($1::text is null or title ilike $1)
        and ($2::uuid is null or parent_id = $2::uuid)
        and ($3::text is null or tags @> array[$3::text])
      order by ${order}
      limit $4`,
    [q, args.parentId ?? null, args.tag ?? null, limit + 1],
  );
  return {
    pages: rows.slice(0, limit).map(toSummary),
    truncated: rows.length > limit,
  };
}

/** Liest eine Seite samt Eltern und Unterseiten. Archivierte Seiten auch. */
async function readPage(run: Tx['query'], id: string): Promise<Page> {
  const rows = await run<PageRow>(`select ${PAGE_COLUMNS} from pages where id = $1`, [id]);
  const row = rows[0];
  if (row === undefined) throw new ToolNotFoundError(`Page ${id} does not exist`);

  const [pathRows, childRows, backlinkRows] = await Promise.all([
    row.parent_id === null ? Promise.resolve([]) : ancestors(run, row.parent_id),
    run<RefRow>(
      `select id, title from pages
        where parent_id = $1 and archived_at is null
        order by lower(title), id`,
      [id],
    ),
    run<RefRow>(
      `select p.id, p.title
         from page_links l
         join pages p on p.id = l.source_id
        where l.target_id = $1 and p.archived_at is null
        order by lower(p.title), p.id
        limit $2`,
      [id, LIMITS.backlinksMax],
    ),
  ]);
  const parent = pathRows[pathRows.length - 1];

  return {
    ...toSummary(row),
    contentMd: row.content_md,
    createdAt: row.created_at.toISOString(),
    createdBy: row.created_by,
    archivedAt: row.archived_at === null ? null : row.archived_at.toISOString(),
    parent: parent === undefined ? null : { id: parent.id, title: parent.title },
    children: childRows.map((child) => ({ id: child.id, title: child.title })),
    path: pathRows.map((ref) => ({ id: ref.id, title: ref.title })),
    backlinks: backlinkRows.map((ref) => ({ id: ref.id, title: ref.title })),
  };
}

/**
 * `startId` und alle Vorfahren, oberste Seite zuerst. Kreisfest ueber den
 * mitgefuehrten Pfad: Eine Id wird nie zweimal besucht, auch wenn die Daten
 * gegen jede Regel einen Kreis enthielten.
 */
async function ancestors(run: Tx['query'], startId: string): Promise<RefRow[]> {
  const rows = await run<RefRow & { depth: number }>(
    `with recursive up (id, parent_id, title, depth, seen) as (
       select id, parent_id, title, 0, array[id] from pages where id = $1
       union all
       select p.id, p.parent_id, p.title, up.depth + 1, up.seen || p.id
         from pages p
         join up on p.id = up.parent_id
        where not p.id = any (up.seen)
     )
     select id, title, depth from up order by depth desc`,
    [startId],
  );
  return rows;
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
    `insert into page_revisions (page_id, change, title, content_md, tags, parent_id, edited_by, edited_at)
     select id, $2, title, content_md, tags, parent_id, $3, updated_at from pages where id = $1`,
    [pageId, change, actor],
  );
}

/**
 * Schreibt die Seitenlinks einer Seite neu, aus ihrem aktuellen Inhalt. Laeuft
 * in derselben Transaktion wie die Aenderung, damit Rueckverweise nie einem
 * anderen Stand folgen als der Inhalt. Ziele, die es nicht gibt, und Links
 * auf sich selbst fallen weg.
 */
async function syncLinks(tx: Tx, pageId: string, contentMd: string): Promise<void> {
  const targets = extractPageLinks(contentMd, LIMITS.linksMax).filter((target) => target !== pageId);
  await tx.query('delete from page_links where source_id = $1', [pageId]);
  if (targets.length === 0) return;
  await tx.query(
    `insert into page_links (source_id, target_id)
     select $1, id from pages where id = any ($2::uuid[])
     on conflict do nothing`,
    [pageId, targets],
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
    await syncLinks(tx, created.id, args.contentMd);
    await enqueuePages(tx, [created.id]);
    return created.id;
  });
  kickSearchSync();
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
    if (contentMd !== current.content_md) await syncLinks(tx, args.id, contentMd);
    // Ein neuer Titel aendert den Pfad jeder Unterseite in der Suche.
    if (title !== current.title) await enqueueSubtree(tx, args.id);
    else await enqueuePages(tx, [args.id]);
  });
  kickSearchSync();
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
    // Archiviert heisst fuer die Suche: entfernen (`search-sync.ts`).
    await enqueuePages(tx, [args.id]);
    return { id: args.id, archivedAt: row.archived_at.toISOString() };
  }).finally(kickSearchSync);
}

interface RevisionRow extends Record<string, unknown> {
  id: string;
  change: RevisionChange;
  parent_id: string | null;
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
    `select id::text as id, change, parent_id, title, content_md, tags, edited_by, edited_at
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
      parentId: row.parent_id,
      title: row.title,
      contentMd: row.content_md,
      tags: row.tags,
      editedBy: row.edited_by,
      editedAt: row.edited_at.toISOString(),
    })),
  };
}

/**
 * Schluessel der Sperre, die alle Verschiebungen dieses Wikis nacheinander
 * laufen laesst. Zwei gleichzeitige Verschiebungen (A unter B, B unter A)
 * saehen sonst beide einen Baum ohne Kreis und schrieben zusammen einen. Die
 * Sperre ist pro Schema, damit sie keine andere App in derselben Datenbank
 * aufhaelt, und gilt nur bis zum Ende der Transaktion.
 */
const MOVE_LOCK = `select pg_advisory_xact_lock(hashtext(current_schema() || ':wiki.pages.move'))`;

/**
 * pages.move — haengt eine Seite unter eine andere Elternseite oder (mit
 * `parentId: null`) auf die oberste Ebene. Unterseiten wandern mit. Abgelehnt:
 * archivierte Seite, archivierte oder fehlende Elternseite, und jedes Ziel,
 * das ein Kreis waere (die Seite selbst oder eine ihrer Unterseiten).
 */
export async function movePage(args: PagesMoveArgs, actor: string): Promise<Page> {
  await transaction(async (tx) => {
    await tx.query(MOVE_LOCK);
    const current = await lockPage(tx, args.id);
    if (current.archived_at !== null) {
      throw new ToolInputError(`Page ${args.id} is archived and cannot be moved`);
    }
    if (current.parent_id === args.parentId) return;

    if (args.parentId !== null) {
      const parentId = args.parentId;
      const parent = await lockPage(tx, parentId).catch((error: unknown) => {
        if (error instanceof ToolNotFoundError) {
          throw new ToolNotFoundError(`Parent page ${parentId} does not exist`);
        }
        throw error;
      });
      if (parent.archived_at !== null) {
        throw new ToolInputError(`Parent page ${parentId} is archived`);
      }
      const chain = await ancestors(tx.query, parentId);
      const problem = moveProblem(args.id, parentId, chain.map((ref) => ref.id));
      if (problem !== undefined) throw new ToolInputError(problem);
    }

    await tx.query(
      `update pages
          set parent_id = $2, updated_by = $3, updated_at = now()
        where id = $1`,
      [args.id, args.parentId, actor],
    );
    await writeRevision(tx, args.id, 'move', actor);
    // Der Pfad der Seite und aller Unterseiten hat sich geaendert.
    await enqueueSubtree(tx, args.id);
  });
  kickSearchSync();
  return getPage({ id: args.id });
}

export interface PageTree {
  tree: TreeNode[];
  /** Mehr als `LIMITS.treeMax` Seiten: mit `rootId` einen Teilbaum holen. */
  truncated: boolean;
}

interface TreeRow extends Record<string, unknown> {
  id: string;
  parent_id: string | null;
  title: string;
  updated_at: Date;
}

/**
 * pages.tree — der Seitenbaum ohne Inhalt. Ohne `rootId` alle nicht
 * archivierten Seiten ab der obersten Ebene, mit `rootId` diese Seite und ihre
 * Unterseiten. Abgeschnitten wird ebenenweise (erst alle Seiten der ersten
 * Ebene, dann der zweiten …), damit nie ein Kind ohne seine Eltern kommt.
 */
export async function pageTree(args: PagesTreeArgs): Promise<PageTree> {
  if (args.rootId !== undefined) {
    const exists = await query<{ id: string }>('select id from pages where id = $1', [args.rootId]);
    if (exists[0] === undefined) throw new ToolNotFoundError(`Page ${args.rootId} does not exist`);
  }
  const rows = await query<TreeRow>(
    `with recursive t (id, parent_id, title, updated_at, depth, seen) as (
       select id, parent_id, title, updated_at, 0, array[id]
         from pages
        where case when $1::uuid is null
                   then parent_id is null and archived_at is null
                   else id = $1::uuid end
       union all
       select p.id, p.parent_id, p.title, p.updated_at, t.depth + 1, t.seen || p.id
         from pages p
         join t on p.parent_id = t.id
        where p.archived_at is null
          and not p.id = any (t.seen)
     )
     select id, parent_id, title, updated_at
       from t
      order by depth, lower(title), id
      limit $2`,
    [args.rootId ?? null, LIMITS.treeMax + 1],
  );
  const kept = rows.slice(0, LIMITS.treeMax);
  const tree = buildTree(
    kept.map((row) => ({
      id: row.id,
      parentId: row.parent_id,
      title: row.title,
      updatedAt: row.updated_at.toISOString(),
    })),
    args.rootId,
  );
  // Ebenenweise sortiert, nach Titel innerhalb einer Ebene: Die Geschwister
  // stehen schon in der richtigen Reihenfolge.
  return { tree, truncated: rows.length > LIMITS.treeMax };
}

/**
 * pages.restore — setzt Titel, Inhalt und Tags auf den Stand einer frueheren
 * Revision und schreibt eine neue Revision `restore`. Der Verlauf bleibt
 * vollstaendig; nichts wird geloescht. Die Elternseite bleibt, wo sie ist —
 * Verschieben ist pages.move.
 */
export async function restorePage(args: PagesRestoreArgs, actor: string): Promise<Page> {
  await transaction(async (tx) => {
    const current = await lockPage(tx, args.id);
    if (current.archived_at !== null) {
      throw new ToolInputError(`Page ${args.id} is archived and cannot be restored to an earlier version`);
    }
    const revisions = await tx.query<{ title: string; content_md: string; tags: string[] }>(
      `select title, content_md, tags from page_revisions where id = $1::bigint and page_id = $2`,
      [args.revisionId, args.id],
    );
    const revision = revisions[0];
    if (revision === undefined) {
      throw new ToolNotFoundError(`Revision ${args.revisionId} of page ${args.id} does not exist`);
    }
    if (
      revision.title === current.title &&
      revision.content_md === current.content_md &&
      sameTags(revision.tags, current.tags)
    ) {
      return;
    }
    await tx.query(
      `update pages
          set title = $2, content_md = $3, tags = $4, updated_by = $5, updated_at = now()
        where id = $1`,
      [args.id, revision.title, revision.content_md, revision.tags, actor],
    );
    await writeRevision(tx, args.id, 'restore', actor);
    await syncLinks(tx, args.id, revision.content_md);
    if (revision.title !== current.title) await enqueueSubtree(tx, args.id);
    else await enqueuePages(tx, [args.id]);
  });
  kickSearchSync();
  return getPage({ id: args.id });
}

/** favorites.list — die Favoriten des Aufrufers, nicht archiviert, nach Titel. */
export async function listFavorites(actor: string): Promise<{ pages: PageSummary[] }> {
  const rows = await query<SummaryRow>(
    `select p.id, p.parent_id, p.title, p.tags, p.updated_at, p.updated_by
       from page_favorites f
       join pages p on p.id = f.page_id
      where f.user_id = $1 and p.archived_at is null
      order by lower(p.title), p.id
      limit $2`,
    [actor, LIMITS.listMax],
  );
  return { pages: rows.map(toSummary) };
}

/** Ob der Aufrufer die Seite als Favorit markiert hat. */
export async function isFavorite(actor: string, pageId: string): Promise<boolean> {
  const rows = await query<{ one: number }>(
    'select 1 as one from page_favorites where user_id = $1 and page_id = $2',
    [actor, pageId],
  );
  return rows.length > 0;
}

/**
 * favorites.set — markiert eine Seite als Favorit des Aufrufers oder nimmt
 * die Markierung weg. Idempotent. Eine archivierte Seite laesst sich nicht neu
 * markieren, wohl aber entfernen.
 */
export async function setFavorite(
  args: FavoritesSetArgs,
  actor: string,
): Promise<{ id: string; favorite: boolean }> {
  const pages = await query<{ archived_at: Date | null }>('select archived_at from pages where id = $1', [
    args.id,
  ]);
  const page = pages[0];
  if (page === undefined) throw new ToolNotFoundError(`Page ${args.id} does not exist`);
  if (args.favorite) {
    if (page.archived_at !== null) {
      throw new ToolInputError(`Page ${args.id} is archived and cannot be added to favorites`);
    }
    await query(
      `insert into page_favorites (user_id, page_id) values ($1, $2)
       on conflict do nothing`,
      [actor, args.id],
    );
  } else {
    await query('delete from page_favorites where user_id = $1 and page_id = $2', [actor, args.id]);
  }
  return { id: args.id, favorite: args.favorite };
}

/** Titel zu Seiten-Ids, fuer Anzeigen wie „Moved under …“. Fehlende fallen weg. */
export async function pageTitles(ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await query<RefRow>('select id, title from pages where id = any ($1::uuid[])', [[...ids]]);
  return new Map(rows.map((row) => [row.id, row.title]));
}
