# This app: knowledge

> The platform rules are in the root [`AGENTS.md`](../../AGENTS.md) and apply
> without exception. This file says where things live in this app.

## Where things live

- `app.json` — manifest: tables `documents`, `chunks`; tools `search`,
  `documents.add`, `documents.list`, `documents.get`, `documents.delete`.
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
  implementation.
- `src/lib/chunk.ts` — the splitting, a pure function.
- `src/app/actions.ts` — the UI's server actions. Each one calls `getUser`
  first and then the same domain logic as the matching tool.

## What does not belong here

No login, no permission checks, no reading of the `X-Auth-*` headers except
through `getUser`. Who may do what is decided by the control plane.
