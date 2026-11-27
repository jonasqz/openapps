# Starter App

Template for an app on the openapps platform. `create_app` copies this
directory into a new repo.

## What is already in it

- `app.json` — the manifest the control plane uses to create schema, role and
  grants
- `openapi.yaml` — two example operations from which the MCP tools are
  generated
- `migrations/0001_items.sql` — an example table
- `seeds/0001_sample.sql` — sample data, loaded locally only
- `src/app/api/items/` — the route handlers for the two operations
- `src/app/page.tsx` — a list with empty and error state
- `src/app/layout.tsx` — the shared platform sidebar: `loadShell(manifest)`
  from `@openapps/sdk/next` reads user and navigation on the server,
  `NextPlatformShell` from `@openapps/ui/next` renders it. The platform
  brings user, app list, settings and sign-out; the app only lists its own
  sections in `SECTIONS` in the same file
- `AGENTS.md` — the order in which an agent works here
- `next.config.js` — the `basePath` from `OPENAPPS_APP_BASE_PATH`: the app
  lives under `https://<domain>/<app-name>`, not on its own subdomain

## Rename before you build

1. `name`, `title`, `description`, `category` in `app.json`
2. `name` in `package.json`
3. set the default of `basePath` under `servers` in `openapi.yaml` to `/<your
   app-name>` — it is the path the app lives under
4. replace the example table `items` with your tables, in `app.json`,
   `openapi.yaml` and a **new** migration
5. list your pages as sections in `SECTIONS` in `src/app/layout.tsx`

## Locally

```bash
cp .env.example .env
pnpm dev
```

Locally `OPENAPPS_APP_BASE_PATH` is empty, so the app runs on `/`. In a
deployment the control plane sets the path, and Next builds all links, images
and JavaScript files under it. Therefore: no hand-written absolute paths
(`<img src="/logo.png">`, `fetch('/api/items')`) — use `next/link`,
`next/image` and relative calls, otherwise the link points to the platform
instead of the app. The review gate checks the `basePath`.

Without the gateway there is no user locally: `getUser` throws, because no
valid signature is present. To call the app locally, generate the five
`X-Auth-*` headers with `signatureFor` from `@openapps/sdk` — the same function
the gateway uses — and set `OPENAPPS_AUTH_SECRET`, `OPENAPPS_APP_ID` and
`OPENAPPS_APP_HOST` to match. The host is the same for all apps — the app id
together with the app's own secret separates them (ADR 0007). Do not build a
shortcut that turns the check off locally: it ends up in production sooner or
later.

The sidebar still renders without the gateway: it shows only this app and a
placeholder instead of the user. Pages keep working.
