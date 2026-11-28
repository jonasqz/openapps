# This app: knowledge

> The platform rules are in the root [`AGENTS.md`](../../AGENTS.md) and apply
> without exception. This file says where things live in this app.

## Where things live

- `app.json` — manifest: tables `documents`, `chunks`, `chunk_embeddings`,
  `embedding_state`; tools `search`, `answer`, `documents.*`,
  `embeddings.status`, `embeddings.backfill`; `gatewayContext:
["readableApps"]`; `databaseExtensions: ["vector"]`.
- `openapi.yaml` — every operation is `POST /tools/<toolname>` with an
  `operationId` and `x-openapps-verb`. A test checks that manifest, spec and
  handlers match.
- `migrations/` — one SQL file per change, never edit an existing one.
  No `create role`, no `grant`, no `create schema`.
- `src/app/api/tools/[tool]/route.ts` — the only API endpoint,
  `createToolRoute` from `@openapps/sdk`.
- `src/lib/tools.ts` — tool name → handler. A new tool goes here, into
  `app.json` and into `openapi.yaml`, otherwise the test fails.
- `src/lib/retriever.ts` — the `Retriever` interface and the full-text
  implementation (English and German).
- `src/lib/hybrid.ts` — full text plus vectors with the same visibility,
  reciprocal rank fusion; exactly full text without a complete embedding.
- `src/lib/embeddings.ts` — the derived queue, budget share, status and
  backfill. `src/lib/platform-models.ts` — `model_info`, `embed`, `generate`
  over the platform; every failure is a status, never a thrown error.
- `src/lib/answer.ts` — `answer`: passages of the caller only, every citation
  checked, `no_answer` instead of a guess.
- `src/lib/knowledge-runtime.ts` — the retrievers and the queue, once per
  process.
- `src/lib/visibility.ts` — applies the signed list of readable apps. Every
  reading function takes it as a required argument.
- `src/lib/chunk.ts` — the splitting, a pure function.
- `src/app/actions.ts` — the UI's server actions. Each one calls `getUser`
  first and then the same domain logic as the matching tool.

## What does not belong here

No login, no permission checks, no reading of the `X-Auth-*` headers except
through `getUser` and `getReadableApps`. Who may do what is decided by the
control plane. The source app of `documents.upsert` and `documents.remove`
comes from `ctx.caller`, never from the arguments.
