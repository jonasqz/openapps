# Local mode: the platform with standard apps on your own machine

The whole platform runs in Docker, without Coolify and without GitHub (ADR 0011).
It comes with four standard apps:

| App         | Path         | What for                                                                          |
| ----------- | ------------ | --------------------------------------------------------------------------------- |
| `wiki`      | `/wiki`      | Pages like in Notion: Markdown, subpages, history, full-text search               |
| `crm`       | `/crm`       | Companies, contacts, deals with a pipeline, activities                            |
| `knowledge` | `/knowledge` | Store documents and find passages with their source (the retrieval half of a RAG) |
| `tasks`     | `/tasks`     | Team tasks with assignee, due date and completion status                          |

The same as on the server:

- The control plane creates a schema and a role per app, sets the env and
  writes the gateway configuration.
- Every app only runs after the review gate, with real gitleaks and semgrep.
- Agents only reach the apps through the platform MCP, with a grant per tool
  and an entry in the audit log.

## Start

```bash
./infra/lokal/einrichten.sh
```

```bash
./infra/lokal/apps-ausrollen.sh
```

- `einrichten.sh` creates `.env` with random secrets and a self-signed
  certificate. Both stay on your machine and are gitignored.
- `lokal.sh` is `docker compose` for this stack. It creates a container of its
  own for every app in `standard-apps/` (ADR 0015).
- `apps-ausrollen.sh` builds the images one after another, starts the stack,
  registers and deploys the apps from `standard-apps/` and creates the agent
  `operator`. It may do what the group `platform-admins` may do. Its token is
  then stored in `infra/lokal/.agents/operator.token` (mode 0600) and is never
  shown.
- A second run creates nothing twice. A changed version of an app is deployed
  again.

## Connect an agent

Locally, the MCP is at `http://localhost:8080/mcp`, on the loopback only.

```bash
claude --mcp-config infra/lokal/.agents/mcp-operator.json
```

`operator` then creates working agents over MCP and grants them rights. Every
app tool has to be granted on its own (`execute` on `<app>.<tool>`). An agent
only sees the tools it may use. If it calls another one anyway, it is blocked,
and both end up in the log. In the MCP, app tools are named `<app>__<tool>`
with `__` instead of a dot, because clients do not accept dots in names.

## Have an app changed or built

With your own Claude Code in the repo, connected to the platform MCP:

```bash
claude --mcp-config infra/lokal/.agents/mcp-operator.json
```

- **New app:** for example "Build me an app for holiday requests". The
  assistant then calls `create_app`. That creates `standard-apps/<name>` from
  the template, with a tool endpoint, migrations and sample data. Then it
  writes the code and rolls it out.
- **Change an app:** for example "Add a lead source field to deals in the
  CRM". New columns come as a new migration. Then the assistant bumps
  `version` in `app.json` and rolls it out.

Roll out one app, or all of them without a name:

```bash
./infra/lokal/apps-ausrollen.sh <name>
```

The app is then available at <http://127.0.0.1:8090/name>. Agents reach its
tools as soon as they have been granted with `grant`.

## Check that agents get through

```bash
pnpm --filter @openapps/platform-mcp test:lokal
```

The test takes the same paths as an agent: `operator` creates two agents and
grants individual tools. Then each agent calls its tools with arguments. A
tool that has not been granted and a self-grant are rejected. The agent
appears in the app as the author, and once it is disabled it can no longer
get in. The test needs no language model and gives the same result on every
run.

## Look at the user interfaces

- **Apps:** <http://127.0.0.1:8090>, signed in as `viewer@local.test`
  (ADR 0013).
- **Admin (control plane):** <http://127.0.0.1:8091>. There you manage apps,
  agents and grants (ADR 0014). The default is the local admin. To look around
  as a user without grants, open <http://127.0.0.1:8091/_local/as/user>; go
  back with <http://127.0.0.1:8091/_local/as/admin>.

Both bypass the Google sign-in and therefore only run locally, on the loopback
only.

## What is missing locally

- **Sign-in for humans.** It goes through Google and needs your own
  credentials (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` in `.env`, redirect
  `https://cp.local.test:8443/api/auth/callback/google`) as well as the entries
  `cp.local.test` and `apps.local.test` pointing to `127.0.0.1` in
  `/etc/hosts`. Without that, the way through `cp.local.test` and
  `apps.local.test` stays behind the sign-in. The viewing proxy shows apps and
  the admin area without it as well.
- **A backend inventory.** The local adapter cannot measure whether an app
  container has ports or Traefik labels. It reports "unreachable" instead of
  "clean".
- **Rollback to an old version.** Locally, there is only the version on disk.

## Clean up

```bash
./infra/lokal/lokal.sh down -v
```
