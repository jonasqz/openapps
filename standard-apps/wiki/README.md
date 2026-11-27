# Wiki

Standard app of openapps: a notes and documents workspace for humans and
agents. Nested pages with a page tree and breadcrumbs, a Markdown editor with
preview and block shortcuts, links between pages with backlinks, favorites,
recently edited pages, full-text search, and a history that records every
change with its author — including changes made by agents — and can restore
any earlier version. Every page is also delivered to the shared search of the
platform (Knowledge, ADR 0020).

## Tools

Every function is a tool first (`POST <basePath>/api/tools/<name>`); the UI
calls the same functions.

| Tool              | Verb  | What it does                                                                                                 |
| ----------------- | ----- | ------------------------------------------------------------------------------------------------------------ |
| `pages.list`      | read  | Pages without content, filter `q` (title), `parentId`, `tag`; `sort: 'updated'` for recently edited, `limit` |
| `pages.tree`      | read  | The page tree without content, optionally from `rootId` down                                                 |
| `pages.get`       | read  | Page with content, parent, subpages, `path` (breadcrumbs) and `backlinks`                                    |
| `pages.search`    | read  | Full text with rank and snippet (`«hit»`)                                                                    |
| `pages.create`    | write | Create a page, optionally as a subpage                                                                       |
| `pages.update`    | write | Change title/content/tags or append with `appendMd`                                                          |
| `pages.move`      | write | Move a page with its subpages; `parentId: null` = top level; no cycles                                       |
| `pages.archive`   | write | Archive; not while subpages are still live                                                                   |
| `pages.history`   | read  | History, newest change first, including moves and restores                                                   |
| `pages.restore`   | write | Restore title, content and tags of an earlier revision                                                       |
| `favorites.list`  | read  | The caller's own favorite pages                                                                              |
| `favorites.set`   | write | Add a page to the caller's favorites or remove it                                                            |
| `search.backfill` | write | Queue every page for the shared search again and deliver what fits into about 20 s; the rest follows         |
| `search.status`   | read  | What is waiting to be delivered to the shared search, how often it failed and why                            |

The descriptions for agents are in `app.json`, the schemas in `openapi.yaml`
and `src/lib/schemas.ts`. A test keeps the three in line.

## Writing

The editor is Markdown with a **Write** and a **Preview** tab. The toolbar
inserts blocks (heading, list, numbered list, checklist, quote, code) and
links to other pages; `⌘B`/`⌘I` wrap bold and italic, `⌘Enter` saves.

- **Checklists:** `- [ ] open` and `- [x] done`. They render as display-only
  boxes; tick them by editing the page (or with `pages.update`).
- **Links between pages:** `[text](page:<id>)`. The page view shows the exact
  syntax under "Link to this page". On every create, update and restore the
  links are read from the content (outside code) and stored in `page_links`;
  the target page shows them under "Linked from" (`backlinks` in `pages.get`).
- **Drafts:** while you type, the editor keeps a draft in this browser's
  `localStorage` (never on the server, never visible to others). Reopening the
  editor offers to restore or discard it, and warns if the page changed in
  the meantime. Saving removes the draft.

## Moving pages

`pages.move` (and "Move" on a page) hangs a page with all its subpages under a
new parent or onto the top level. The new parent must not be the page itself
or one of its subpages; the check walks the ancestors of the new parent in the
database. Moves run one after another (a transaction-level advisory lock per
schema), so two crossing moves at the same time cannot form a cycle together.

## Rendering is safe

Markdown is parsed into a tree and rendered as React elements — no HTML
strings, no `dangerouslySetInnerHTML`. Raw HTML stays text. Links become links
only for absolute `http(s)` URLs and for `page:` followed by a UUID; the page
path is built from the checked UUID. Everything else (`javascript:`, `data:`,
relative paths, `page:../x`) stays plain text.

## Search

The full-text index uses the Postgres English dictionary
(`migrations/0002_english_search.sql`). Exact words always match; English
word forms are matched by stemming (`request` finds `requests`). Words in
other languages match only exactly, without their word forms. Common English
stop words such as `the` or `and` are ignored.

## Shared search (Knowledge)

The wiki delivers its pages to Knowledge, the shared search of the platform
(ADR 0020). It contains no permission code for this: the platform decides
whether the wiki may deliver, and Knowledge shows a page only to callers who
may read the wiki.

- **Outbox.** Creating, editing, restoring, moving and archiving a page
  writes a row into `search_outbox` in the same transaction as the change.
  Renaming or moving a page also queues all its subpages, because their path
  (shown as the source of a hit, for example `Wiki › Handbook › Onboarding`)
  changes.
- **After the commit** the wiki delivers without waiting: the current state of
  the page goes to `knowledge.documents.upsert` (key = page id, link back
  `/pages/<id>`), an archived page goes to `knowledge.documents.remove`. The
  call runs through the platform with `callAppTool` from `@openapps/sdk`, as
  `app:wiki`.
- **Saving never fails because of Knowledge.** If Knowledge is unreachable,
  the grant is missing or Knowledge is still on an older version, the row stays
  with its error. It is retried on the next write, on start and every 60
  seconds while something is pending. A change made during a delivery is not
  lost: rows are only deleted with the version that was delivered.
- **First run.** The first start with 0.3.0 queues every page once
  (`search_sync`). `search.backfill` does it again on demand,
  `search.status` shows what is stuck and why.
- **Grants.** The manifest requests `execute` for `app:wiki` on
  `knowledge.documents.upsert` and `knowledge.documents.remove`. They are
  granted centrally with `grant` (`subjectKind: app`, `subjectId: wiki`,
  `resourceKind: tool`); locally `lokal-einrichten` grants them.
- **Env.** `OPENAPPS_PLATFORM_URL` and `OPENAPPS_CALL_SECRET`, set by the
  control plane. Without them nothing is delivered and the rows wait.

## Pages

| Path                  | What                                                           |
| --------------------- | -------------------------------------------------------------- |
| `/`                   | Page tree, or search hits with `?q=`; filter with `?tag=`      |
| `/favorites`          | Your favorite pages                                            |
| `/recent`             | Recently edited pages                                          |
| `/new`                | New page, optionally with `?parent=<id>`                       |
| `/pages/<id>`         | A page with breadcrumbs, the page tree, subpages and backlinks |
| `/pages/<id>/edit`    | Edit a page                                                    |
| `/pages/<id>/history` | History of a page, with "Restore this version"                 |

## Layout

- `migrations/0001_wiki.sql` — `pages` (with a generated `tsvector` column and
  a GIN index) and `page_revisions`
- `migrations/0002_english_search.sql` — the search column with the English
  dictionary
- `migrations/0003_history_moves_restores.sql` — revisions remember the parent
  page; new changes `move` and `restore`
- `migrations/0004_favorites.sql` — `page_favorites`
- `migrations/0005_page_links.sql` — `page_links` for backlinks
- `migrations/0006_search_outbox.sql` — `search_outbox` and `search_sync`
  for the shared search
- `seeds/0001_beispielseiten.sql`, `seeds/0002_links_und_checklisten.sql` —
  sample pages of the fictional Northlight Ltd (local only)
- `src/instrumentation.ts` — runs the migrations on start and starts the
  delivery to the shared search
- `src/lib/pages.ts` — data access, one function per tool
- `src/lib/search-sync.ts` — outbox, delivery to Knowledge, `search.backfill`
  and `search.status`
- `src/lib/tools.ts`, `src/app/api/tools/[tool]/route.ts` — the tool route
- `src/app/actions.ts` — server actions of the UI; they check `getUser` and
  call the same functions
- `src/app/layout.tsx` — the shared platform sidebar (`loadShell` from
  `@openapps/sdk/next`, `NextPlatformShell` from `@openapps/ui/next`); the
  app only adds its sections in `SECTIONS`
- `src/lib/markdown.ts`, `src/components/Markdown.tsx` — a small Markdown
  renderer of its own, without `dangerouslySetInnerHTML`; links only http(s)
  and `page:<uuid>`
- `src/lib/move.ts`, `src/lib/tree.ts` — the cycle rule and the page tree,
  without a database
- `src/lib/editing.ts`, `src/lib/draft.ts`, `src/app/PageForm.tsx` — the
  editor

## Local

```bash
cp .env.example .env
pnpm dev
```

Without `DATABASE_URL` the app starts, skips the migrations with a warning and
shows the error state on every page.

## Tests

```bash
pnpm test
```

The database tests (`src/lib/pages.db.test.ts`) only run with
`WIKI_TEST_DATABASE_URL` and `WIKI_TEST_DATABASE_SCHEMA` — as the app role (no
owner, no superuser) with its own empty schema. Otherwise they are skipped.
They also cover the outbox: saving while Knowledge is unreachable or the grant
is missing, delivery once it is back, no lost change during a delivery,
subpages after a rename or move, archive as remove, and the backfill.
