# Plugin `openapps`

With this plugin, your own Claude Code builds and changes apps on the openapps
platform. The plugin contains three things:

- **the connection to the platform MCP.** The address comes from
  `OPENAPPS_MCP_URL` (the default is the local stack,
  `http://localhost:8080/mcp`), the token from `OPENAPPS_TOKEN`.
- **the skill `build-platform-app`** with the rules of the platform.
- **four commands:** `/openapps:new-app`, `/openapps:change-app`,
  `/openapps:status` and `/openapps:sync`.

## Install

In Claude Code:

```text
/plugin marketplace add jonasqz/openapps
/plugin install openapps@openapps
```

If you installed an older version, update it with
`/plugin update openapps@openapps`, otherwise the new commands are missing.

## Connect

Every assistant needs its own agent access. Create it in the admin under
"Agents" or have it created through the MCP. The token is shown exactly once.
It belongs in your environment, not in a repo and not in a chat.

Locally, the token of the agent `operator` is already in a file:

```bash
export OPENAPPS_TOKEN="$(cat infra/lokal/.agents/operator.token)"
```

On a server, add the address:

```bash
export OPENAPPS_MCP_URL="https://<control-plane>/mcp"
```

Then start `claude` and check with `/openapps:status` what your access allows.

## Sync a session

`/openapps:sync` keeps your assistant and the platform in step. It syncs
results, never the chat itself.

- `/openapps:sync pull <topic>` before work: searches all apps and the team
  memory for the topic and summarizes what exists, with links.
- `/openapps:sync push` after work: proposes what to file (open tasks,
  decisions as wiki pages, short notes for the team memory, links between
  objects) and files only what you confirm.

Personal preferences stay in your assistant's own memory. Secrets and
transcripts never go to the platform.

The command needs these grants for the agent access, and skips any part
whose grant is missing:

| What            | Grant                                                                                                                            |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Search          | `read` on each app, and `execute` on its search tool: `tasks.search`, `crm.search`, `wiki.pages.search`, `knowledge.documents.search` |
| Open references | `execute` on each app's resolver tool: `tasks.tasks.resolve`, `wiki.pages.resolve`, `crm.crm.resolve`                            |
| Team memory     | `execute` on tool `platform.recall` and `platform.remember`                                                                      |
| Tasks           | `execute` on tool `tasks.tasks.create`                                                                                           |
| Decision pages  | `execute` on tools `wiki.pages.create` and `wiki.pages.update`                                                                   |

Without the search tool grant an app is skipped silently: `search` then
answers with an empty `searched` list. Without a resolver grant a reference
comes back as `restricted`.

### Alone or as a team

Alone, one agent access for your assistant is enough. In a team, every
person gets their own agent access, never a shared token: the audit log then
shows whose assistant did what, and access can be revoked for one person.
Everyone installs the same plugin, so every assistant follows the same rules.
The team memory and the wiki replace scattered local notes.

## What the assistant may do

Only what its agent access allows. The platform checks every call and writes
it to the audit log. The plugin grants no permissions, it only connects.
