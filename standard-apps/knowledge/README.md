# Knowledge

Standard app of openapps and the **shared search of the platform**: store
documents, let other apps deliver their content (the wiki is the first),
split everything into sections and find relevant passages with their source.
This is the **retrieval half of a RAG** — the calling agent writes the answer
itself, from the returned passages and citing their sources (ADR 0020).

## Tools

Every function is a tool first (`app.json` → `offeredTools`, `openapi.yaml`
→ `POST /tools/<name>`); the UI calls the same domain logic.

| Tool               | Verb  | What it does                                                                                                                                                                                                          |
| ------------------ | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search`           | read  | `query`, `limit` (default 5, at most 20). Returns `passages` with `chunkId`, `documentId`, `documentTitle`, `source`, `sourceApp`, `sourcePath`, `sourceUrl`, `ord`, `score`, `excerpt` (matches in `«»`) and `text`. |
| `documents.search` | read  | `query`, `limit`. One hit per document stored in Knowledge itself (`id`, `title`, `snippet`, `url`, `kind`), without content of other apps. Knowledge's tool for the search across all apps (ADR 0021). |
| `documents.add`    | write | `title`, `content`, `source?`. Splits and stores in one transaction, returns `id` and `chunkCount`. Documents added this way have no source app.                                                                      |
| `documents.list`   | read  | `q?` filters by title or source. Without full text. Only what the caller can see.                                                                                                                                     |
| `documents.get`    | read  | `id`, `includeChunks?`. Deleted documents and documents from apps the caller may not read return 404.                                                                                                                 |
| `documents.delete` | write | `id`. Soft delete: afterwards neither in search nor in the list. Refused (400) for documents of a source app; they are removed there.                                                                                 |
| `documents.upsert` | write | Apps only. `key`, `title`, `content`, `source?`, `path?`, `updatedAt?`. Replaces the calling app's own document with this key, sections included, in one transaction. Returns `id`, `key`, `status`, `chunkCount`.    |
| `documents.remove` | write | Apps only. `key`. Removes the calling app's own document with this key for good. Idempotent: `removed` is `false` if there was nothing.                                                                               |

## Content from other apps

Any app can deliver its content here (ADR 0020). It calls
`knowledge.documents.upsert` and `knowledge.documents.remove` through the
platform with `callAppTool` from `@openapps/sdk`, and needs the grant
`execute` on both tools for `app:<name>`.

- **The source app comes from the verified identity, never from the
  arguments.** The tool route only accepts the call if the platform signed it
  as `app:<name>` (`ctx.caller`). The schemas are strict: a `sourceApp` field
  is a 400. An app can therefore only replace or remove its own documents.
  A human or an agent gets 400 and uses `documents.add`.
- **Key per app.** `(source_app, source_key)` is unique. The same key from
  two apps is two documents.
- **Older states are ignored.** With `updatedAt`, a delivery older than the
  stored state changes nothing (`status: "stale"`), so a late retry never
  overwrites a newer state.
- **Link back.** `path` is a path inside the source app (`/pages/<id>`); it
  must start with `/` and cannot leave the app (no `//`, no `.`/`..`
  segments). Hits carry `sourceApp`, `sourcePath` and `sourceUrl`
  (`https://<shared domain>/<app><path>`). The UI shows "from Wiki" and links
  there.

### Who sees what

Knowledge contains no permission code. The platform sends the apps the caller
may read as a signed header (`X-Auth-Readable-Apps`, requested with
`gatewayContext: ["readableApps"]` in `app.json`); the SDK verifies it
(`getReadableApps`, `ctx.readableApps`).

- Documents without a source app: visible to everyone who can open Knowledge.
- Documents of a source app: only if that app is in the list.
- No valid list (header missing, forged, expired): only documents without a
  source app — never an error.

This holds for humans (forward auth), agents (platform MCP) and apps (app
calls). An agent sees wiki hits only with `read` on `app:wiki`.

## Pages

| Path              | What it shows                                           |
| ----------------- | ------------------------------------------------------- |
| `/`               | Search with matching sections and their source          |
| `/documents`      | All stored documents, newest first                      |
| `/documents/new`  | Form to add a document                                  |
| `/documents/<id>` | One document with its sections (anchors `#section-<n>`) |

## How search works

Postgres 16 without pgvector, no embedding model and no external API. Search
is therefore Postgres full-text search in English **and German**: every
section has two generated columns, `tsv = to_tsvector('english', text)` and
`tsv_de = to_tsvector('german', text)`, each with a GIN index. The search
first runs strictly with `websearch_to_tsquery` in both languages (all words,
quotes for phrases, `-word` excludes). A section matches if either language
matches; its rank is the better of the two `ts_rank_cd` values, not the sum,
so a word both dictionaries stem the same way does not count twice. The
excerpt comes from the language with the better rank. If that returns fewer
than `limit` matches, an OR query over the single words fills up, from four
letters also as a prefix (`mile:*`), because the stemmer does not split
compound words. Matches from the strict stage always come first, duplicates
are dropped. The excerpt comes from `ts_headline` and marks matches with `«`
and `»` instead of HTML; the UI renders them as `<mark>`, without
`dangerouslySetInnerHTML`.

Search sits behind the `Retriever` interface in `src/lib/retriever.ts`, and
the visibility is a required argument of every implementation. When
pgvector arrives, that becomes a second implementation of the same interface
(vector column in a new migration, embeddings on store, selection in
`currentRetriever()` in `src/lib/tools.ts`) — tools, response format and UI
stay unchanged. A hybrid variant that merges both rankings would be a third.

## How documents are split

`src/lib/chunk.ts`, a pure function: about 800 characters per section, at most 1200. Splits happen at paragraph breaks (blank line), otherwise at sentence
boundaries, otherwise at word boundaries and only as a last resort hard. Every
section except the first starts with about 150 characters from the end of the
previous one, preferably from the start of a sentence. Empty sections are
dropped.

## Data

- `migrations/0001_knowledge.sql` — `documents` and `chunks`.
- `migrations/0002_document_sources.sql` — source app, key, path and state
  per document, unique per (app, key).
- `migrations/0003_german_search.sql` — the German full-text column.
- `seeds/0001_sample_documents.sql` — four fictional documents of Northlight
  Ltd (travel expenses, quotes, IT security, product sheet), local only. The
  seed only creates the documents; they are split on start in
  `src/instrumentation.ts` with the same function as `documents.add`. The
  reasoning is in the comment there.

Migrations run on start (`src/instrumentation.ts`, `runMigrations` from the
SDK) with the app's role in its own schema. Without `DATABASE_URL` there is
only a warning.

## Local

```bash
cp .env.example .env
pnpm dev
pnpm typecheck && pnpm lint && pnpm test
```

The database tests (`test/documents.db.test.ts`) only run with
`KNOWLEDGE_TEST_DATABASE_URL` and `KNOWLEDGE_TEST_DATABASE_SCHEMA` — as the
app role with its own empty schema. They cover hits from apps the caller may
not read, replacing and removing foreign sources, older states and German word
forms.

Without the gateway there is no user locally; calls need the five `X-Auth-*`
headers, signed with `signatureFor` from `@openapps/sdk` (see the README of
the starter app). The request host must match `OPENAPPS_APP_HOST` (`Host` or
`X-Forwarded-Host`).
