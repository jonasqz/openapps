# This app

> You are building an app for the openapps platform. The platform rules are in
> the root [`AGENTS.md`](../../AGENTS.md) and apply without exception. This
> file says where things go in this template.

## The order you work in

1. `app.json` — name, category, tables, tools, permissions, env. First,
   because the platform derives schema, role and grants from it.
2. `openapi.yaml` — every function as an operation, with `operationId` and
   `x-openapps-verb` (`read`, `write` or `execute`). The MCP tools are
   generated from it. A UI action without an operation here blocks the review
   gate.
3. `migrations/` — one SQL file per change, numbered in ascending order. Never
   change an existing migration. No `create role`, no `grant`, no
   `create schema`: the control plane does that.
4. `src/app/api/` — the route handlers, exactly the operations from the spec.
5. `src/app/` — the screens, only now. Only with `@openapps/ui`.

## Where your path comes from

The app is reachable at `https://<domain>/<app-name>`, not on its own
subdomain (ADR 0007). `next.config.js` sets that path as `basePath` from
`OPENAPPS_APP_BASE_PATH`; the control plane sets the variable per deployment.
Leave the line as it is and do not hard-code the path anywhere — the review
gate checks both.

What depends on it: every absolute path you write yourself bypasses the
`basePath`. `<img src="/logo.png">` and `fetch('/api/items')` end up on the
platform, not in your app. Use `next/link` and `next/image` (they include the
`basePath`) and call your own endpoints relatively.

## Where you get the user

```ts
import { getUser } from '@openapps/sdk';

const user = getUser(request.headers); // throws if the request did not come through the gateway
```

Do not build a login. Never read the `X-Auth-*` headers yourself — only via
`getUser`, because only the SDK checks that the request really came through
the gateway.

## Where you get the database

```ts
import { createAppPool } from '@openapps/sdk';

const pool = createAppPool();
const { rows } = await pool.query(
  'select id, title, created_at from items order by created_at desc',
);
```

The client is pinned to your schema. Other apps' data only via a grant issued
in the control plane — never via a second connection.

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
