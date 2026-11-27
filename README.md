# openapps

A lean app layer **next to** Coolify. It controls Coolify through its REST API
and MCP, leaves Coolify itself unchanged (Apache 2.0, no fork), and gives
internal apps and agents a shared foundation: one login, one permission model,
one review gate, one design system.

> Status: **v1 under construction.** First used internally at blyck
> (dogfooding), then a decision on a standalone open-source project. See
> [`docs/00-brief.md`](docs/00-brief.md) (German).

## Agents first

Every function exists first as an API and an MCP tool; the interface comes
afterwards and uses the same API. Whatever a person can do in the UI, an agent
can do over MCP, with the same permissions from the same permission model.

## Structure

| Path                    | What                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `apps/control-plane`    | The only runtime app of its own: create, deploy, grant, roll back apps (Next.js, Postgres, Better Auth) |
| `apps/platform-mcp`     | Platform MCP at `/mcp`: apps, deploys, grants, groups, agent identities (15 tools)                      |
| `packages/app-manifest` | Schema and types for `app.json` (manifest + catalog sources)                                            |
| `packages/ui`           | Design system: tokens, components, patterns (list, form, detail, empty, error)                          |
| `packages/sdk`          | Client for apps: user from headers, DB client on the app's own schema                                   |
| `templates/starter-app` | Starter template for new apps (OpenAPI first, then screens)                                             |
| `infra/`                | Traefik forward auth, Postgres roles, operations scripts                                                |
| `docs/`                 | Brief, architecture, roadmap, DoD, decisions (German)                                                   |

## Try it locally, with standard apps and agents

`infra/lokal/` starts the whole platform in Docker, without Coolify and without
GitHub. It comes with four standard apps from `standard-apps/`: `wiki` (pages
like in Notion), `crm`, `knowledge` (documents with passage search, the
retrieval half of a RAG) and `tasks`. Guide:
[`infra/lokal/README.md`](infra/lokal/README.md) (German). What real agents
have done with it is in
[`docs/nachweise/lokal-agents.md`](docs/nachweise/lokal-agents.md) (German).

Locally, you switch roles at `/_local/as/admin` and `/_local/as/user`.

## Build apps with your own assistant

Your own Claude Code, connected to the platform MCP, builds and changes apps.
The plugin [`plugins/openapps`](plugins/openapps/README.md) brings three
things:

- the connection to the MCP, with address and token from the environment;
- the rules of the platform as a skill (`build-platform-app`);
- the commands `/openapps:new-app`, `/openapps:change-app` and
  `/openapps:status`.

Install in Claude Code:

```text
/plugin marketplace add jonasqz/openapps
/plugin install openapps@openapps
```

How to connect is explained in the admin on the page `/get-started`. For
assistants without a browser, the same is in the MCP prompt `get_started`.

## Deploy to a server

One server with Coolify, one Compose file, one list of variables:
[`infra/betrieb/README.md`](infra/betrieb/README.md) (German). Where the
project is headed is in [`docs/08-zielbild.md`](docs/08-zielbild.md) (German).

## Get started

```bash
pnpm install
pnpm check
```

## Contributing

- Rules for agents that build apps for this platform: [`AGENTS.md`](AGENTS.md)
- Rules for working **on** this repo: [`CLAUDE.md`](CLAUDE.md) (German)
- Secrets check: `pnpm install` enables a pre-commit hook (`.githooks/pre-commit`)
  that scans staged changes with [gitleaks](https://github.com/gitleaks/gitleaks),
  using the same rules as CI. Install it with `brew install gitleaks`. Without
  gitleaks the hook runs a minimal built-in check for the most obvious patterns
  (private keys, common token prefixes, `.env` files, `infra/lokal/.agents/`) and
  still blocks on a match. Run `pnpm secrets` to scan the whole working tree.
  For a verified false positive, add `gitleaks:allow` as a comment on that line.
- License: still open, see [`docs/06-lizenz.md`](docs/06-lizenz.md) (German)
