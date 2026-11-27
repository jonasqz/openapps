# @openapps/platform-mcp

The platform's MCP server. It offers the six tools of the brief plus lookup
and group management, serves `AGENTS.md` and the get-started guide as prompts,
and forwards the apps' tools — each only to callers that have a grant.

## The tools

| Tool             | What it does                                                                      |
| ---------------- | --------------------------------------------------------------------------------- |
| `create_app`     | create a repo from the starter template, register the app, set up schema and role |
| `request_deploy` | start the review gate, deploy if it passes                                        |
| `list_apps`      | list the apps the caller has `read` on                                            |
| `rollback`       | roll back to the previous version                                                 |
| `grant`          | grant a permission                                                                |
| `revoke`         | revoke a grant                                                                    |
| `list_grants`    | look up grants                                                                    |
| `whoami`         | who you are: identity, groups, apps you can open, grants with their source        |

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

## Prompts

- `how_to_build_app` returns the content of `AGENTS.md`, read fresh on every
  call. Agents on MCP get the same rules as agents in Claude Code — one source,
  no copy.
- `get_started` returns the same guide as the `/get-started` page of the
  control plane: plugin, agent access, address and token, example requests.

## Layout

```
src/tools.ts       the platform tools as data: name, schema, handler
src/app-tools.ts   visibility and invocation of app tools
src/identity.ts    one OAuth client per agent
src/invoker.ts     forwarding to the app, through the gateway
src/server.ts      thin wiring to the MCP SDK
src/prompts.ts     the prompts
src/index.ts       start over stdio
src/http.ts        start over HTTP, identity per call
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
pnpm --filter @openapps/platform-mcp test         # DoD 6 test
```

There is no build step: the server runs from the TypeScript source via `tsx`,
because it includes the control plane's domain as source.

## Evidence

`tests/agent-grants.spec.ts` — DoD 6: two agents (with and without a grant),
visibility, blocking, immediate effect of revocation and one audit entry each.
Anything that needs a real transport is listed there as `it.todo`.
