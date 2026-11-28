# @openapps/platform-mcp

The platform's MCP server. It offers the six tools of the brief plus lookup,
the search across all apps, group management, platform agents and the team
memory, serves `AGENTS.md` and the get-started guide as prompts,
and forwards the apps' tools — each only to callers that have a grant.

## The tools

| Tool                  | What it does                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------------- |
| `create_app`          | create a repo from the starter template, register the app, set up schema and role             |
| `request_deploy`      | start the review gate, deploy if it passes                                                    |
| `list_apps`           | list the apps the caller has `read` on                                                        |
| `rollback`            | roll back to the previous version                                                             |
| `grant`               | grant a permission                                                                            |
| `revoke`              | revoke a grant                                                                                |
| `list_grants`         | look up grants                                                                                |
| `whoami`              | who you are: identity, groups, apps you can open, grants with their source                    |
| `search`              | search all apps you may search at once, hits grouped by app (ADR 0021)                        |
| `search_tools`        | find tools you may execute here, platform and app tools, by text match (ADR 0024 addendum)    |
| `describe_tool`       | full description and input schema of one tool you may execute, otherwise `not_found`          |
| `list_inbox`          | your own inbox: notifications from apps you may read (ADR 0022)                               |
| `mark_inbox`          | mark items of your own inbox as read, unread or done                                          |
| `resolve_refs`        | resolve `@{app:type:id}` references to title and status, `restricted` without read (ADR 0023) |
| `list_backlinks`      | what points to an item, only if you may read both apps                                        |
| `list_people`         | people and agents with `read` on an app, to mention them                                      |
| `list_actions`        | what other apps can create from an item (for example a task from a wiki page)                 |
| `configure_agent`     | create or change the profile of a platform agent (needs `write` on `agent:<name>`, ADR 0024)  |
| `list_agent_profiles` | platform agents you may see or start, and whether a chat model is configured                  |
| `start_agent_run`     | start a run of a platform agent (needs `execute` on `agent:<name>`)                           |
| `get_agent_run`       | one run: status, result, steps, tokens, origin, tool calls                                    |
| `list_agent_runs`     | runs you started and runs of agents you look after                                            |
| `remember`            | write a note to the team memory, with its origin (needs `execute` on `platform.remember`)     |
| `recall`              | search the team memory, only notes whose whole origin you may read                            |
| `list_memories`       | the newest notes, or those of one agent                                                       |
| `forget`              | delete a note for good                                                                        |

`list_inbox` and `mark_inbox` need no grant of their own and only ever touch
the caller's inbox. Every item needs `read` on its source app at the time of
the call; after a revoke the items disappear on the next call.

The four reference tools need no grant of their own. `resolve_refs` gives an
agent a title only with `read` on the target app and `execute` on its
resolver tool (`tasks.tasks.resolve`, `wiki.pages.resolve`, `crm.crm.resolve`);
titles are cached for up to 60 seconds, permissions are checked on every call.
`list_actions` lists an action only with `execute` on its tool.

Platform agents (ADR 0024) run inside the platform with the configured chat
model only; without `OPENAPPS_CHAT_*` every agent tool answers
`not_configured` and nothing else breaks. A run sees exactly the tools its
agent sees here, limited to what the person who started it may do, and
without `create_agent`, `start_agent_run` and `configure_agent`. Every call in
a run is audited with the run id as `correlationId`. The runs are executed by
`src/runner.ts`, the third process in the control plane container
(`start.sh`), concurrency `OPENAPPS_AGENT_RUN_CONCURRENCY` (default 2, 1 to
10); its tools come from this server through an in-process MCP connection
(`src/run-toolbox.ts`).

`whoami` needs no grant and only ever shows the caller's own grants: those
made to the caller directly and those made to one of the caller's groups. An
agent is in no group, so it only sees its direct grants. Each grant carries
its source in `via`, so a right that comes both directly and through a group
appears twice — revoking one of them is not enough:

```json
{
  "me": {
    "kind": "user",
    "id": "u-lena",
    "email": "lena@example.com",
    "groups": ["sales"],
    "isAdmin": false,
    "canCreateApps": false,
    "apps": [
      { "name": "crm", "title": "CRM", "category": "Sales", "href": "https://apps.example.com/crm" }
    ],
    "grants": [
      {
        "id": "…",
        "subject": { "kind": "user", "id": "u-lena" },
        "verb": "read",
        "resource": { "kind": "app", "id": "crm" },
        "via": { "kind": "direct" },
        "grantedBy": "user:u-admin",
        "grantedAt": "…",
        "revokedAt": null,
        "revokedBy": null
      },
      {
        "id": "…",
        "subject": { "kind": "group", "id": "sales" },
        "verb": "read",
        "resource": { "kind": "app", "id": "crm" },
        "via": { "kind": "group", "group": "sales" },
        "grantedBy": "user:u-admin",
        "grantedAt": "…",
        "revokedAt": null,
        "revokedBy": null
      }
    ],
    "agent": null
  }
}
```

Revoked grants are left out. `GET /api/me` in the control plane returns the
same object, and the `/settings` page shows it. Every call is logged once
with the action `whoami`.

Group management (migrations 0009 and 0011 — a group is a subject **and** a
resource):

| Tool                  | What it does                                           | Needs                |
| --------------------- | ------------------------------------------------------ | -------------------- |
| `list_groups`         | list the groups the caller has `read` on               | `read` on the group  |
| `create_group`        | create a group, empty                                  | `write` on `group:*` |
| `list_group_members`  | members of a group                                     | `read` on the group  |
| `grant_group_member`  | add an email address, idempotent                       | `write` on the group |
| `revoke_group_member` | remove an email address, takes effect on the next call | `write` on the group |

Agent identities (migration 0014):

| Tool            | What it does                                       | Needs                |
| --------------- | -------------------------------------------------- | -------------------- |
| `list_agents`   | list the agent identities the caller has `read` on | `read` on the agent  |
| `create_agent`  | create an agent identity, returns its token once   | `write` on `agent:*` |
| `disable_agent` | disable an agent identity                          | `write` on the agent |

`write` on `group:*` for creating, not on the new name: before it is created
the name does not exist, so anyone who manages some group could grant
themselves a permission on it.

On top of that come the app tools, named `<app-name>.<tool>`. Only the granted
ones are registered, and only those may be called — the call checks a second
time, because hiding is not enforcement.

### Apps as subjects

`grant` also takes `subjectKind: app`. That is how an app gets the right to
call a tool of another app (ADR 0020), for example the wiki delivering pages
to the shared search:

```json
{
  "subjectKind": "app",
  "subjectId": "wiki",
  "verb": "execute",
  "resourceKind": "tool",
  "resourceId": "knowledge.documents.upsert"
}
```

Apps do not use the MCP. They call
`POST /api/apps/<app>/tools/<tool>` on the control plane with their own
signature (`callAppTool` from `@openapps/sdk`). Grant check, audit entry
(`call_app_tool`) and forwarding are the same function as for agents
(`callAppTool` in the control plane domain), so both paths cannot drift.

### Readable apps

If the target app asks for `gatewayContext: ["readableApps"]` in its manifest
(Knowledge does), the forwarded call carries the signed list of apps the
agent may read (`X-Auth-Readable-Apps`). An agent with only `execute` on
`knowledge.search` therefore sees no wiki hits; it also needs `read` on
`app:wiki`.

### Search across all apps

`search` takes `query` (2 to 200 characters), optionally `apps` (names) and
`limit` (hits per app, 1 to 10, default 5). It asks every app whose manifest
names a search tool, in parallel, with about 2 seconds each, and returns
`{ query, results: [{ app, title, hits }], failed: [{ app, title, reason }], searched }`.
An agent gets an app only with `read` on the app **and** `execute` on its
search tool (for example `crm.search`, `wiki.pages.search`,
`knowledge.documents.search`); without both the app is not asked and not
mentioned. `search` itself needs no grant, like `list_apps`. It is the same
domain function as the bar's search (`searchApps`), with one audit entry
`search` per call and without the query text in the log.

### Finding tools

`search_tools` and `describe_tool` let an agent find tools on demand instead
of reading the whole catalog first (ADR 0024, addendum "Code Mode", point 1).
`search_tools` takes `query` (2 to 200 characters), optionally `apps` (app
names, `platform` for the platform tools) and `limit` (1 to 25, default 10),
and returns `{ query, tools: [{ name, kind, resourceId, app, summary }], matched }`.
`name` is the MCP name to call (`tasks__tasks__create`), `resourceId` the id
in the permission model (`tasks.tasks.create`, `platform.<name>` for platform
tools). Ranking is a plain text match over name and description: exact name
first, then words in the name, then words in the description; no embeddings.

Both show only tools of this session that the caller may execute: every
platform tool (each checks its own grants when called) and the app tools
with `execute`, checked again on every call, so a revoke hides a tool on the
next call without a new connection. `describe_tool` takes the MCP name or the
resource id and answers `not_found` with `unknown tool "<name>"` for a tool
without a grant, exactly as for a tool that does not exist. Neither needs a
grant of its own, like `search` and `whoami`. Each call is audited once
(`search_tools`, `describe_tool`), without the query text. In a platform
agent run both are offered and leave out the tools a run never gets
(`RUN_EXCLUDED_TOOLS`).

## Prompts

- `how_to_build_app` returns the content of `AGENTS.md`, read fresh on every
  call. Agents on MCP get the same rules as agents in Claude Code — one source,
  no copy.
- `get_started` returns the same guide as the `/get-started` page of the
  control plane: plugin, agent access, address and token, example requests.

## Layout

```
src/tools.ts       the platform tools as data: name, schema, handler
src/tool-catalog.ts the session's tool catalog and ranking for search_tools and describe_tool
src/app-tools.ts   visibility and invocation of app tools (from the control plane domain)
src/identity.ts    one OAuth client per agent
src/invoker.ts     forwarding to the app (from the control plane, shared with app calls)
src/server.ts      thin wiring to the MCP SDK
src/prompts.ts     the prompts
src/index.ts       start over stdio
src/http.ts        start over HTTP, identity per call
src/runner.ts      runner for platform agent runs (third process, ADR 0024)
src/runner-loop.ts queue loop of the runner, testable without a process
src/run-toolbox.ts the tools of a run: this server, in process, with the run's rights
tests/             DoD 6
```

The tools contain no logic and no permission checks of their own: they call
the domain functions of `@openapps/control-plane`. That way an endpoint cannot
drift from its tool. The manifest is checked with `appManifestSchema` from
`@openapps/app-manifest`, not a second schema.

A forwarded call carries the agent's identity in the same five headers as a
call through the gateway, signed with the secret of **that** app
(`identityHeadersForApp`). The MCP knows no app secret: it derives it from
`OPENAPPS_AUTH_MASTER_SECRET`, just like the forward auth.

## Running

```bash
pnpm --filter @openapps/platform-mcp start        # stdio, for Claude Code
pnpm --filter @openapps/platform-mcp start:http   # HTTP, for agents
pnpm --filter @openapps/platform-mcp start:runner # runner for platform agent runs
pnpm --filter @openapps/platform-mcp test         # DoD 6 test
```

There is no build step: the server runs from the TypeScript source via `tsx`,
because it includes the control plane's domain as source.

## Evidence

`tests/agent-grants.spec.ts` — DoD 6: two agents (with and without a grant),
visibility, blocking, immediate effect of revocation and one audit entry each.
Anything that needs a real transport is listed there as `it.todo`.
