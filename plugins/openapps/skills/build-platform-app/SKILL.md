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
- the shared platform sidebar (`PlatformShell`) in `src/app/layout.tsx`, with
  the app's own sections in `src/components/Shell.tsx`

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
  - The sidebar comes from the platform (`PlatformShell` from `@openapps/ui`,
    wired up in `src/app/layout.tsx`). It brings the user, the app list,
    "New app", settings and sign-out. Your app only provides its sections:
    one entry per page in `SECTIONS` in `src/components/Shell.tsx`. Do not
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

## Change an app

1. Read `app.json`, `src/lib/tools.ts` and the affected pages.
2. New columns or tables come as a new migration.
3. Add a new tool to `app.json` and to `src/lib/tools.ts`.
4. Bump the `version`, check and roll out as above.
5. If the tool is new, grant it to the agents that need it.

## When something is broken

On the server, `rollback` resets the app to the previous version. Then fix
the error and roll out again the same way.
