# Platform rules for agents

This file applies to every agent that builds an **app for this platform**.
Follow it and you get through the review gate on the first deploy.

The same guide is available as the Claude skill `build-platform-app` and as
the MCP prompt `how_to_build_app` through the platform MCP.

## The seven rules

1. **Do not build your own login.** The user comes from five request headers
   that the gateway sets: `X-Auth-User-Id`, `X-Auth-User-Email`,
   `X-Auth-Groups`, `X-Auth-Issued-At` and `X-Auth-Signature`. The last one is
   an HMAC over the others plus host and app id. Do **not** read any of them
   yourself. Only `getUser` from `@openapps/sdk` checks the signature, the
   time window and the domain. Without this check, any client can set the
   headers itself (ADR 0004).
2. **Use only your own schema.** The app gets exactly one DB role and exactly
   one schema. No superuser connection, no `search_path` trick, no access to
   other apps' tables. Other data only through a grant issued in the control
   plane.
3. **Every function as an API first.** Describe it in `openapi.yaml`. The
   platform generates the app's MCP tools from it. A UI action without a
   matching API endpoint blocks the review gate.
4. **Maintain the manifest.** `app.json` describes name, category, version,
   required tables, offered tools, requested permissions, the source and,
   optionally, the app's search tool. If you change tables or tools, change
   the manifest with them.
5. **No secrets in code.** Only through env variables, declared in the
   manifest.
6. **Only the design system.** Components and tokens from `@openapps/ui`. No
   custom color values, no second UI library. Every list has an empty state
   and an error state, every form has validation with a visible error
   message. The sidebar comes from the platform: `PlatformShell` from
   `@openapps/ui` renders users, the app list, settings and sign-out. Your
   app only provides its own sections: a `SECTIONS` table in
   `src/app/layout.tsx`, passed to `NextPlatformShell` from
   `@openapps/ui/next` together with `loadShell(manifest)` from
   `@openapps/sdk/next` (the template shows how). Do not copy or rebuild
   that wiring. No navigation, login or user menu of your own.
7. **Nothing bypasses the gateway.** No outbound network access except to the
   targets declared in the manifest.

## Other apps and search

- **Call another app only through the platform:** `callAppTool(app, tool,
args)` from `@openapps/sdk`. The call is signed with your app's own
  `OPENAPPS_CALL_SECRET`, arrives as `app:<your-name>` and only goes through
  with a grant `execute` on `<app>.<tool>`. Request that grant in
  `requestedGrants` (`subjectKind: app`, `subjectId: <your-name>`), declare
  `OPENAPPS_PLATFORM_URL` and `OPENAPPS_CALL_SECRET` in `env` and the control
  plane in `egress`. Never call another app's container directly.
- **Make content findable in the shared search (Knowledge):** deliver it with
  `knowledge.documents.upsert` (`key` = your id, `title`, `content`, `path` =
  link back inside your app, `updatedAt`) and remove it with
  `knowledge.documents.remove`. Knowledge takes your app name from your
  verified identity, so you can only replace your own content, and it only
  shows it to callers who may read your app.
- **Never let a save fail because of another app.** Write what you want to
  deliver into an outbox table in the same transaction, deliver after the
  commit, retry later, and offer a backfill tool. `createOutbox` from
  `@openapps/sdk` is that loop; the wiki uses it
  (`standard-apps/wiki/src/lib/search-sync.ts`).
- **Tell people what happened (events, ADR 0022):** declare each event type
  in `app.json` under `events` (`type` like `task.assigned`, `description`,
  `importance`), request `execute` on the tool `emit_event` of the app
  `platform` for yourself, and emit with `createEventOutbox({ query })` from
  `@openapps/sdk`: `emit(tx, event)` inside the transaction of the change,
  `kick()` after the commit. An event carries an `id` (unique in your app),
  `type`, `object`, a short `title`, a `path` inside your app and an
  `audience` (`human:<email>`, `user:<id>`, `group:<name>`, `agent:<name>`;
  `recipientOf` builds it). No content beyond the title. The platform decides
  who gets a notification: only people who may read your app, never the one
  who caused it. Do not filter recipients yourself. Undeclared types are
  rejected.
- **React to other apps' events:** list them under `"subscriptions"`, request
  `read` on the source app plus `execute` on `platform.poll_events` and
  `platform.ack_events`, and use `subscribe(types, handler)` from the SDK.
  Delivery is at least once: make the handler idempotent on `event.id`.
- **Link to other apps and mention people (references, ADR 0023):** in
  stored text write only the reference, never a title: `@{app:type:id}` for
  an item (`@{tasks:task:42}`, `@{wiki:page:9f2c}`) and `@{human:<email>}`
  or `@{agent:<name>}` for a mention. Declare the item types other apps may
  link to under `"objects"` with a read tool as `resolver`
  (`{ type, ids }` in, `{ objects: [{ id, title, path, status?, updatedAt }] }`
  out, `parseResolveArgs` in `@openapps/sdk`). Report the **full set** of an
  item's outgoing references with `createRefsOutbox({ query }).report(tx, …)`
  inside the transaction of the change (table `refs_outbox`, like the event
  outbox) and request `execute` on `platform.set_refs` for yourself. The
  platform resolves chips, keeps backlinks and notifies mentioned people, only
  those who may read your app. Show chips, backlinks and the picker with
  `RefText`, `BacklinksPanel` and `MentionPicker` from `@openapps/ui`; they
  load through `/_platform/…` in the browser, never through your server.
- **Create Y from X (actions):** to let people and agents create one of your
  items from another app's item, add an `"actions"` entry
  (`name`, `title`, `accepts: ["wiki:page"]`, `tool`, `path`). The tool takes
  `{ sourceRef, excerpt? }` and reports the reference with kind `derived`;
  `path` is the page in your app where a person confirms, with `ref` and
  `excerpt` as query parameters.
- **Show up in the search across all apps:** offer a read tool that takes
  `{ query, limit }` and returns `{ hits: [{ id, title, snippet?, url, kind? }] }`
  (`SearchToolResult` and `parseSearchArgs` in `@openapps/sdk`; `url` is a
  path in your app without the base path), and name it in `app.json`:
  `"search": { "tool": "search" }`. The platform calls it in parallel with
  the other apps, as the caller, with about 2 seconds per app (ADR 0021).
  People see your hits if they may open your app; agents also need
  `execute` on the tool. Keep it fast and never write in it.
- **Showing content of other apps:** request
  `gatewayContext: ["readableApps"]` in `app.json` and filter with
  `getReadableApps` (or `ctx.readableApps` in a tool). `null` means: show
  nothing that belongs to another app. This is the only way; do not check
  permissions yourself.
- **Use the platform model (ADR 0024):** if the operator configured one, call
  `callAppTool('platform', 'generate', { instruction, contents?, maxTokens? })`
  or `callAppTool('platform', 'embed', { texts })` and request `execute` on
  `platform.generate` / `platform.embed` for yourself. Every content item is
  `{ id, sourceApp, text }`: name the app the text comes from honestly. Items
  from apps the operator keeps in-house come back under `withheld` and never
  reach an external provider. Handle status 503 with `not_configured` (no
  model: fall back to what works without one) and status 429 with
  `budget_exceeded` (daily limit: retry later). The key never reaches your
  app; usage counts on `app:<your-name>`. `callAppTool('platform', 'model_info')`
  tells you, without a model call and without tokens, which model applies
  (only for the tools you hold a grant on) and how much of today's limit your
  app has used: portion large jobs (a backfill) so they leave room for
  interactive calls and continue the next UTC day, and never raise the limit
  yourself.
- **Use pgvector (ADR 0025):** list `"databaseExtensions": ["vector"]` in
  `app.json`. The platform then gives your role `USAGE` on the schema
  `extensions` (never `CREATE`); without the field you get nothing there.
  Name the type and operators fully qualified (`extensions.vector`,
  `OPERATOR(extensions.<=>)`) and do not change the `search_path`. If the
  operator has not set up the extension yet, the deploy fails with a message
  that names the one-time step.

## The path from empty to live

1. `list_apps`: does the app already exist?
2. `create_app`: creates a repo from the starter template.
3. Build and test locally, then push.
4. `request_deploy`: runs `gitleaks`, `semgrep`, the UI linter and the
   Claude review.
5. On approval, the control plane sets up schema, DB role, env and auth
   middleware and deploys through Coolify.
6. `grant`: grants to groups, other apps and agents. Only then are the app's
   MCP tools active.
7. Every new version goes through the same pipeline. `rollback` resets to the
   previous version in under 2 minutes.

## What the review gate blocks

- a secret in the code (`gitleaks`)
- a finding from `semgrep` in the security rule set
- a UI action without a matching MCP tool
- a custom color value or a foreign UI library
- a DB connection outside the app's own schema
- a manifest that does not match the code

A Claude review is not proof of security. It always runs together with the
deterministic scanners, never in their place.
