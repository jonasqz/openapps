# Wiki

Standard app of openapps: a notes and documents workspace for humans and
agents. Nested pages with a page tree and breadcrumbs, a Markdown editor with
preview and block shortcuts, links between pages with backlinks, favorites,
recently edited pages, full-text search, and a history that records every
change with its author — including changes made by agents — and can restore
any earlier version.

## Tools

Every function is a tool first (`POST <basePath>/api/tools/<name>`); the UI
calls the same functions.

| Tool             | Verb  | What it does                                                                                                 |
| ---------------- | ----- | ------------------------------------------------------------------------------------------------------------ |
| `pages.list`     | read  | Pages without content, filter `q` (title), `parentId`, `tag`; `sort: 'updated'` for recently edited, `limit` |
| `pages.tree`     | read  | The page tree without content, optionally from `rootId` down                                                 |
| `pages.get`      | read  | Page with content, parent, subpages, `path` (breadcrumbs) and `backlinks`                                    |
| `pages.search`   | read  | Full text with rank and snippet (`«hit»`)                                                                    |
| `pages.create`   | write | Create a page, optionally as a subpage                                                                       |
| `pages.update`   | write | Change title/content/tags or append with `appendMd`                                                          |
| `pages.move`     | write | Move a page with its subpages; `parentId: null` = top level; no cycles                                       |
| `pages.archive`  | write | Archive; not while subpages are still live                                                                   |
| `pages.history`  | read  | History, newest change first, including moves and restores                                                   |
| `pages.restore`  | write | Restore title, content and tags of an earlier revision                                                       |
| `favorites.list` | read  | The caller's own favorite pages                                                                              |
| `favorites.set`  | write | Add a page to the caller's favorites or remove it                                                            |

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
- `seeds/0001_beispielseiten.sql`, `seeds/0002_links_und_checklisten.sql` —
  sample pages of the fictional Northlight Ltd (local only)
- `src/instrumentation.ts` — runs the migrations on start
- `src/lib/pages.ts` — data access, one function per tool
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
