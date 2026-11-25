# Wiki

Standard app of openapps: knowledge pages like in Notion, for humans and
agents. Page tree, Markdown, full-text search and a history that records every
change with its author — including changes made by agents.

## Tools

Every function is a tool first (`POST <basePath>/api/tools/<name>`); the UI
calls the same functions.

| Tool | Verb | What it does |
| --- | --- | --- |
| `pages.list` | read | Pages without content, filter `q` (title), `parentId`, `tag` |
| `pages.get` | read | Page with content, parent and subpages |
| `pages.search` | read | Full text with rank and snippet (`«hit»`) |
| `pages.create` | write | Create a page, optionally as a subpage |
| `pages.update` | write | Change title/content/tags or append with `appendMd` |
| `pages.archive` | write | Archive; not while subpages are still live |
| `pages.history` | read | History, newest change first |

The descriptions for agents are in `app.json`, the schemas in `openapi.yaml`
and `src/lib/schemas.ts`. A test keeps the three in line.

## Search

The full-text index uses the Postgres English dictionary
(`migrations/0002_english_search.sql`). Exact words always match; English
word forms are matched by stemming (`request` finds `requests`). Words in
other languages match only exactly, without their word forms. Common English
stop words such as `the` or `and` are ignored.

## Pages

| Path | What |
| --- | --- |
| `/` | Page tree, or search hits with `?q=`; filter with `?tag=` |
| `/new` | New page, optionally with `?parent=<id>` |
| `/pages/<id>` | A page |
| `/pages/<id>/edit` | Edit a page |
| `/pages/<id>/history` | History of a page |

## Layout

- `migrations/0001_wiki.sql` — `pages` (with a generated `tsvector` column and
  a GIN index) and `page_revisions`
- `migrations/0002_english_search.sql` — the search column with the English
  dictionary
- `seeds/0001_beispielseiten.sql` — sample pages of the fictional Northlight
  Ltd (local only)
- `src/instrumentation.ts` — runs the migrations on start
- `src/lib/pages.ts` — data access, one function per tool
- `src/lib/tools.ts`, `src/app/api/tools/[tool]/route.ts` — the tool route
- `src/app/actions.ts` — server actions of the UI; they check `getUser` and
  call the same functions
- `src/app/layout.tsx`, `src/lib/shell.ts`, `src/components/Shell.tsx` — the
  shared platform sidebar (`PlatformShell`); the app only adds its sections
- `src/lib/markdown.ts`, `src/components/Markdown.tsx` — a small Markdown
  renderer of its own, without `dangerouslySetInnerHTML`; links only http(s)

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
