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
   required tables, offered tools, requested permissions and the source. If
   you change tables or tools, change the manifest with them.
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
