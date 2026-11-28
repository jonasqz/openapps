# Wiki

> You are building an app for the openapps platform. The platform rules are in
> the root [`AGENTS.md`](../../AGENTS.md) and apply without exception. This
> file says where things go in this app.

## The order you work in

1. `app.json` — name, category, tables, tools, permissions, env. First,
   because the platform derives schema, role and grants from it.
2. `openapi.yaml` — every function as an operation, with `operationId` and
   `x-openapps-verb` (`read`, `write` or `execute`). The MCP tools are built
   from it. A UI action without an operation here blocks the review gate.
3. `migrations/` — one SQL file per change, numbered in ascending order. Never
   change an existing migration. No `create role`, no `grant`, no
   `create schema`: the control plane does that.
4. `src/app/api/` — the route handlers, exactly the operations from the spec.
5. `src/app/` — the screens, only now. Only with `@openapps/ui`.

## Where your path comes from

The app is reachable at `https://<domain>/<app-name>`, not on its own
subdomain (ADR 0007). `next.config.js` sets this path as `basePath` from
`OPENAPPS_APP_BASE_PATH`; the control plane sets the variable per deployment.
Leave that line as it is and never hard-code the path — the review gate
checks both.

What depends on it: every absolute path you write yourself bypasses the
`basePath`. `<img src="/logo.png">` and `fetch('/api/tools/pages.list')` end up
on the platform, not in your app. Use `next/link` and `next/image` (they add
the `basePath`) and call your own endpoints with relative paths.

## Where you get the user

```ts
import { getUser } from '@openapps/sdk';

const user = await getUser(request.headers); // throws if the call did not come through the gateway
```

Do not build a login. Never read the `X-Auth-*` headers yourself — only via
`getUser`, because only the SDK checks that the call really came through the
gateway.

## Where you get the database

```ts
import { db } from '@openapps/sdk';

const rows = await db.query('select id, title, created_at from items order by created_at desc');
```

The client is pinned to your schema. Data from other apps only through a grant
issued in the control plane — never through a second connection.

## Where pages go to the shared search

Every write in `src/lib/pages.ts` also queues the page in `search_outbox`, in
the same transaction (`enqueuePages`, `enqueueSubtree` from
`src/lib/search-sync.ts`), and calls `kickSearchSync()` after the commit. A new
write function does the same. Delivery goes through the platform with
`callAppTool` from `@openapps/sdk`; never call Knowledge directly and never
let a failed delivery fail the save (ADR 0020).

Edits and restores also queue `page.updated` for the people who favorited the
page (`emitPageUpdated` from `src/lib/events.ts`, ADR 0022), in the same
transaction, and call `kickEvents()` after the commit. Who gets notified is
decided by the platform, not here.

## Where the UI comes from

```ts
import { Button, Table, EmptyState, ErrorState } from '@openapps/ui';
```

No custom colour values, no second UI library. Every list has an empty and an
error state. The linter blocks the rest.

## Before the first deploy

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Then `request_deploy` via the platform MCP. What the gate blocks is listed in
the root `AGENTS.md`.
