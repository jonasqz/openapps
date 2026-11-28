---
name: build-platform-app
description: Builds a new app for the openapps platform or changes an existing one, from idea to live. The steps are create_app, manifest, migrations, tools for agents, screens from the design system, rollout through the review gate, and grants. Use when an internal app or an agent tool should be created or changed on openapps, or when someone says "new app", "create an app", "change an app", "deploy", "request_deploy", "review gate", or in German „neue App“, „App anlegen“ or „App ändern“.
---

# Build or change an app for the platform

openapps is the app layer next to Coolify. An app:

- sits behind the shared login, with no login code of its own;
- sees only its own schema in Postgres;
- also offers its functions to agents, as tools through the platform MCP;
- uses only the design system `@openapps/ui` for its interface.

The platform decides who may do what. There is no permission code in the app.

The binding rules come from the MCP prompt `how_to_build_app`. In the openapps
repo they are also in `AGENTS.md`. Read them before you start.

## 0. Where are you?

- **Local:** You are working in the openapps repo and the MCP runs at
  `http://localhost:8080/mcp`. Apps live in `standard-apps/<name>`. Roll out
  with `./infra/lokal/apps-ausrollen.sh <name>`.
- **Server:** Every app has its own Git repo. Roll out with `request_deploy`
  and a pushed commit.

If it is unclear where you are, check whether `infra/lokal/lokal.sh` exists.

## 1. Does the app already exist?

Call `list_apps`. If the app already exists, keep working on it (section
"Change an app"). Do not create a second one under another name.

## 2. Create a new app

Call `create_app`:

- `name`: short and lowercase, `a-z`, digits, hyphen.
- `displayName`: plain text.
- `manifest`: the template's `app.json` with your name, your description and
  your category.

This creates the repo or folder from the template and sets up the schema and
DB role. Locally, the app then lives in `standard-apps/<name>`.

The template already includes:

- Tool endpoint: `src/app/api/tools/[tool]/route.ts` with `createToolRoute`
- Tools: `src/lib/tools.ts`
- Migrations on startup: `src/instrumentation.ts`
- Sample data in `seeds/`, loaded only locally
- a list page with an empty state and an error state
- the shared platform sidebar in `src/app/layout.tsx`: `loadShell(manifest)`
  from `@openapps/sdk/next` and `NextPlatformShell` from `@openapps/ui/next`,
  with the app's own sections in `SECTIONS` in the same file

## 3. Manifest first

Maintain `app.json` before you write code:

- `requiredTables`: the tables of your app.
- `offeredTools`: every tool with `name` (for example `requests.list`), a
  description and `verb`, which is `read` or `write`. Exactly these names also
  appear in `src/lib/tools.ts`.
- `env`: variables the app needs. Secrets only as a variable, never as a
  value.
- `version`: Bump it with every new state, otherwise the review gate rejects
  it.
- `search` (optional): `{ "tool": "<name of a read tool>" }` puts your app
  into the search across all apps (see below).

## 4. Build

- **Migrations:** one file per change in `migrations/`, numbered in ascending
  order (`0002_…sql`). Never change an existing one. No `create role`, no
  `grant`, no `create schema`.
- **Sample data:** in `seeds/`, not in `migrations/`. Otherwise it ends up on
  the server.
- **Tools for agents:** in `src/lib/tools.ts`, inputs with `parseArgs` and
  zod. Invalid input produces a message the agent can learn from.
- **Users:** only through `getUser` or `ctx.user` from `@openapps/sdk`. An
  agent appears as `agent:<name>`. Store it as the author.
- **Database:** only through the pool from `@openapps/sdk`, in your own schema.
- **Screens:**
  - Only components from `@openapps/ui`, for example `Table`, `FormPattern`,
    `DetailPattern`, `Input`, `Textarea`.
  - No custom color values, no second UI library.
  - Every list has an empty state and an error state.
  - Pages with data need `export const dynamic = 'force-dynamic'`.
  - Links within the app go through `next/link`, because the app runs under
    `/<name>`.
  - The sidebar comes from the platform (`NextPlatformShell` from
    `@openapps/ui/next`, wired up in `src/app/layout.tsx`). It brings the
    user, the app list, "New app", settings and sign-out. Your app only
    provides its sections: one entry per page in `SECTIONS` in
    `src/app/layout.tsx` (`id`, `label`, `path` without the base path,
    optional `match`). Keep the rest of the layout as it is; do not write
    your own `loadShell`, `usePathname` or `router.push` wiring, and do not
    build navigation, a login or a user menu of your own.
  - Pages render no `<main>` and no outer padding; the sidebar provides both.

## 5. Check

```bash
pnpm --filter ./standard-apps/<name> typecheck
pnpm --filter ./standard-apps/<name> test
```

Red means red. The review gate checks the same things again.

## 6. Roll out

**Local:**

```bash
./infra/lokal/apps-ausrollen.sh <name>
```

This builds the container and deploys it through the review gate. Afterwards
the app is available at `http://127.0.0.1:8090/<name>`.

**Server:** Commit and push. Then call `request_deploy` with `app`, `version`
from `app.json`, and `gitSha` of the pushed commit.

The review gate runs `gitleaks`, `semgrep` and the platform's checks. If it
reports findings, fix them (file and rule are listed), bump the version and
roll out again. A finding is never bypassed.

## 7. Grant access

Without a grant nobody sees anything; that is default-deny. Grant only what
the task requires:

- People: `grant` with `subjectKind: group`, `verb: read`,
  `resourceKind: app`, `resourceId: <name>`.
- Agents: one `grant` per tool with `subjectKind: agent`, `verb: execute`,
  `resourceKind: tool`, `resourceId: <name>.<tool>`.

In the MCP, app tools are called `<app>__<tool>`, and every dot becomes `__`.
`tasks.create` in the app `tasks` becomes `tasks__tasks__create`. The
arguments go into the `args` field. `list_grants` shows your own grants.

The MCP assembles the list of tools when you connect. A tool you have just
been granted therefore only shows up after a new connection (in Claude Code
via `/mcp` or a new session). That is not a problem with the grant.

## Make content findable in the shared search

Knowledge is the shared search of the platform. Your app delivers its content
there; Knowledge shows it only to callers who may read your app (ADR 0020).

1. **Manifest:** request the two grants for your app itself and declare the
   env and the egress:

   ```json
   "requestedGrants": [
     { "subjectKind": "app", "subjectId": "<name>", "verb": "execute",
       "resource": { "kind": "tool", "app": "knowledge", "name": "documents.upsert" },
       "reason": "Deliver <things> to the shared search." },
     { "subjectKind": "app", "subjectId": "<name>", "verb": "execute",
       "resource": { "kind": "tool", "app": "knowledge", "name": "documents.remove" },
       "reason": "Remove deleted <things> from the shared search." }
   ],
   "env": [
     { "name": "OPENAPPS_PLATFORM_URL", "secret": false, "required": false, "description": "…" },
     { "name": "OPENAPPS_CALL_SECRET", "secret": true, "required": false, "description": "…" }
   ],
   "egress": [
     { "host": "openapps-control-plane", "protocol": "http", "port": 3000, "reason": "Calls to other apps go through the platform." }
   ]
   ```

2. **Outbox:** a new migration with an outbox table (one row per item, with
   a version). Every write that changes an item inserts or bumps its row **in
   the same transaction**.
3. **Deliver after the commit**, without waiting and without ever failing the
   save:

   ```ts
   import { callAppTool } from '@openapps/sdk';

   await callAppTool('knowledge', 'documents.upsert', {
     key: item.id, // your id; unique within your app
     title: item.title,
     content: item.text, // plain text, non-empty
     source: 'Requests › 2026', // readable origin shown with the hit
     path: `/requests/${item.id}`, // link back, inside your app
     updatedAt: item.updatedAt, // older states are ignored
   });
   await callAppTool('knowledge', 'documents.remove', { key: item.id });
   ```

   Delete the outbox row only with the version you delivered. On an
   `AppCallError` keep the row and its error; retry on the next write, on
   start and on a timer. `createOutbox` from `@openapps/sdk` does all of
   that; see how the wiki uses it in `standard-apps/wiki/src/lib/search-sync.ts`.

4. **Backfill:** a tool that queues everything again (the wiki has
   `search.backfill`) and one that shows what is stuck (`search.status`).
5. **Grant:** locally `apps-ausrollen.sh` grants what your app requests for
   itself. On a server, `grant` with `subjectKind: app`, `subjectId: <name>`,
   `verb: execute`, `resourceKind: tool`,
   `resourceId: knowledge.documents.upsert` (and `.remove`).

Do not pass a source app in the arguments; Knowledge rejects it and takes
your name from your verified identity.

## Tell people what happened (inbox)

The platform has one inbox per person and agent, shown on Home (ADR 0022).
Your app reports events; the platform decides who sees them (only people who
may read your app, never the one who caused it).

1. Declare each type in `app.json` under `events`, with `type`
   (`task.assigned`), `description` and `importance` (`high`, `normal`,
   `low`). Undeclared types are rejected.
2. Request `execute` on the tool `emit_event` of the app `platform` for
   yourself, declare `OPENAPPS_PLATFORM_URL` and `OPENAPPS_CALL_SECRET`, and
   the control plane as egress.
3. Add a migration with the table `event_outbox` (DDL in
   `packages/sdk/src/outbox.ts`) and emit inside the transaction of the
   change with `createEventOutbox({ query }).emit(tx, event)`. Call `kick()`
   after the commit and `start()` at startup. An event has `id`, `type`,
   `object`, `title`, `path`, `actor` and `audience`; build the audience with
   `recipientOf(...)`. No content beyond the title.

## Link to other apps and mention people (references)

Text in your app can point to items of other apps and to people (ADR 0023).
Store only the reference, never a title: someone reading your page may not be
allowed to see the other app.

1. **Write references:** `@{app:type:id}` for an item (`@{tasks:task:42}`),
   `@{human:<email>}` or `@{agent:<name>}` to mention someone. People and
   agents you may mention: MCP tool `list_people` with your app name.
2. **Let others link to you:** declare your item types under `"objects"` in
   `app.json` with a read tool as `resolver`. It takes `{ type, ids }`
   (`parseResolveArgs` in `@openapps/sdk`) and returns
   `{ objects: [{ id, title, path, status?, updatedAt }] }`; unknown ids are
   left out. The platform checks the viewer's rights before it calls it.
3. **Report references:** add a migration with the table `refs_outbox` (same
   columns as `event_outbox`), report the **full set** of an item's
   references inside the transaction of the change with
   `createRefsOutbox({ query }).report(tx, { source, targets, updatedAt, title, path, actor })`
   and request `execute` on `platform.set_refs` for yourself. An empty set
   deletes; mentioned people who may read your app get a notification.
4. **Show them:** `RefText`, `BacklinksPanel`, `MentionPicker` and
   `RefActionsMenu` from `@openapps/ui`, with `createRefResolver()` and the
   other loaders. They load in the browser through `/_platform/…`.
5. **Create Y from X:** an `"actions"` entry (`name`, `title`,
   `accepts: ["wiki:page"]`, `tool`, `path`) offers "Create task" on other
   apps' items. The tool takes `{ sourceRef, excerpt? }` and reports kind
   `derived`; `path` is where a person confirms.

## Use the platform model

The platform may have a model configured by its operator (ADR 0024); without
one, everything still works and the model tools answer `not_configured`.

1. **Grant:** request `execute` on `platform.generate` and/or
   `platform.embed` for yourself in `requestedGrants`.
2. **Call:** `callAppTool('platform', 'generate', { instruction, contents?, maxTokens? })`
   returns `{ status, text, withheld, model, usage }`;
   `callAppTool('platform', 'embed', { texts })` returns
   `{ status, model, embeddings: [{ id, vector }], withheld }`. Each content
   item is `{ id, sourceApp, text }` with the app the text really comes from.
3. **Handle the answers:** items from apps the operator keeps in-house come
   back under `withheld`; status 503 with `not_configured` means no model,
   status 429 with `budget_exceeded` means the daily limit is reached. Never
   let a save fail because of either.
4. **Plan large jobs:** `callAppTool('platform', 'model_info')` costs no
   tokens and returns the model for each tool you may call and
   `budget: { resetsAt, subject: { limit, used }, installation: { limit, used } }`.
   Take only a share of the day for a backfill, pause until `resetsAt` and
   continue then; never raise the limit yourself.
5. **Vectors in your own schema:** add `"databaseExtensions": ["vector"]` to
   `app.json` and use `extensions.vector` and `OPERATOR(extensions.<=>)` fully
   qualified. Your role gets `USAGE` on `extensions`, never `CREATE`; the
   `search_path` stays your schema.

## Show up in the search across all apps

The bar's "Search or jump to… ⌘K" and the platform MCP tool `search` ask
every app that names a search tool, in parallel, and group the hits by app
(ADR 0021). There is no index: your app searches its own data, as the caller.

1. **Tool:** a read tool (often `search`) that takes `{ query, limit }` and
   returns `{ hits: [{ id, title, snippet?, url, kind? }] }`. `url` is a path
   in your app without the base path (`/requests/42`); `kind` says what the
   hit is (`request`). Check the arguments with `parseSearchArgs` from
   `@openapps/sdk` (or the same limits with zod: query 1 to 200 characters,
   limit 1 to 20, default 5) and type the result as `SearchToolResult`.
2. **Manifest:** list the tool in `offeredTools` with `verb: read`, in
   `openapi.yaml` and in `src/lib/tools.ts`, and add
   `"search": { "tool": "search" }`.
3. **Fast and harmless:** the platform waits about 2 seconds per app and
   calls the tool while people type. Never write anything in it.

People see your hits if they may open your app. Agents also need `execute`
on `<name>.search`, granted like every other tool.

## Change an app

1. Read `app.json`, `src/lib/tools.ts` and the affected pages.
2. New columns or tables come as a new migration.
3. Add a new tool to `app.json` and to `src/lib/tools.ts`.
4. Bump the `version`, check and roll out as above.
5. If the tool is new, grant it to the agents that need it.

## When something is broken

On the server, `rollback` resets the app to the previous version. Then fix
the error and roll out again the same way.
