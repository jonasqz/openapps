# Plugin `openapps`

With this plugin, your own Claude Code builds and changes apps on the openapps
platform. The plugin contains three things:

- **the connection to the platform MCP.** The address comes from
  `OPENAPPS_MCP_URL` (the default is the local stack,
  `http://localhost:8080/mcp`), the token from `OPENAPPS_TOKEN`.
- **the skill `build-platform-app`** with the rules of the platform.
- **three commands:** `/openapps:new-app`, `/openapps:change-app` and
  `/openapps:status`.

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

## What the assistant may do

Only what its agent access allows. The platform checks every call and writes
it to the audit log. The plugin grants no permissions, it only connects.
