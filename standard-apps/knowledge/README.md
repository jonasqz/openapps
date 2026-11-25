# Knowledge

Standard app of openapps: store documents, split them into sections and find
relevant passages with their source. This is the **retrieval half of a RAG** —
the calling agent writes the answer itself, from the returned passages and
citing their sources.

## Tools

Every function is a tool first (`app.json` → `offeredTools`, `openapi.yaml`
→ `POST /tools/<name>`); the UI calls the same domain logic.

| Tool               | Verb  | What it does                                                                                                                                                                  |
| ------------------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search`           | read  | `query`, `limit` (default 5, at most 20). Returns `passages` with `chunkId`, `documentId`, `documentTitle`, `source`, `ord`, `score`, `excerpt` (matches in `«»`) and `text`. |
| `documents.add`    | write | `title`, `content`, `source?`. Splits and stores in one transaction, returns `id` and `chunkCount`.                                                                           |
| `documents.list`   | read  | `q?` filters by title or source. Without full text.                                                                                                                           |
| `documents.get`    | read  | `id`, `includeChunks?`. Deleted documents return 404.                                                                                                                         |
| `documents.delete` | write | `id`. Soft delete: afterwards neither in search nor in the list.                                                                                                              |

## Pages

| Path              | What it shows                                           |
| ----------------- | ------------------------------------------------------- |
| `/`               | Search with matching sections and their source          |
| `/documents`      | All stored documents, newest first                      |
| `/documents/new`  | Form to add a document                                  |
| `/documents/<id>` | One document with its sections (anchors `#section-<n>`) |

## How search works

Postgres 16 without pgvector, no embedding model and no external API. Search
is therefore English Postgres full-text search: every section has a generated
column `tsv = to_tsvector('english', text)` with a GIN index. The search first
runs strictly with `websearch_to_tsquery('english', q)` (all words, quotes for
phrases, `-word` excludes), ranked with `ts_rank_cd`. If that returns fewer
than `limit` matches, an OR query over the single words fills up, from four
letters also as a prefix (`mile:*`), because the stemmer does not split
compound words. Matches from the strict stage always come first, duplicates
are dropped. The excerpt comes from `ts_headline` and marks matches with `«`
and `»` instead of HTML; the UI renders them as `<mark>`, without
`dangerouslySetInnerHTML`.

Search sits behind the `Retriever` interface in `src/lib/retriever.ts`. When
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

Without the gateway there is no user locally; calls need the five `X-Auth-*`
headers, signed with `signatureFor` from `@openapps/sdk` (see the README of
the starter app). The request host must match `OPENAPPS_APP_HOST` (`Host` or
`X-Forwarded-Host`).
