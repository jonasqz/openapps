# Browser tests against the local stack

Playwright tests for the risky paths, run against the local stack from
`infra/lokal` (ADR 0011, 0013, 0014, 0017). They need Docker and a running
stack, so they are **not** part of `pnpm check`. Only `typecheck` and `lint`
of this package run there.

## Run

```bash
./infra/lokal/einrichten.sh        # first time only
./infra/lokal/apps-ausrollen.sh    # first time only: build, deploy, create `operator`
COMPOSE_PARALLEL_LIMIT=1 ./infra/lokal/lokal.sh up -d
pnpm e2e
```

If Chromium is missing: `pnpm --filter @openapps/e2e exec playwright install chromium`.

## What is covered

| Spec                     | Path                                                                                                                                                                                                                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin.spec.ts`          | Admin area on `127.0.0.1:8091`: as admin reachable with the Admin link, `/settings` shows the person; as user no Admin link, `/settings` shows the user; the user cannot grant or create agents; foreign origins are rejected.                                                               |
| `gateway-access.spec.ts` | The real path through Traefik and forward auth (`https://apps.local.test:8443`): no session means login, no grant means 403, a grant opens the app, the bar lists only granted apps, switching works, revoking takes effect on the next request, forged `X-Auth-*` headers are not believed. |
| `view-proxy.spec.ts`     | Apps viewing proxy on `127.0.0.1:8090`: the bar lists the deployed apps and switches between them, forged identity and navigation headers are dropped.                                                                                                                                       |
| `review-gate.spec.ts`    | Review gate over the platform MCP: a manifest with the wrong version, a manifest that does not match the code and an invalid manifest are blocked, and the live deployment stays the same.                                                                                                   |

The tests only look at the shared bar (`PlatformShell`), access and status
codes, never at the content of an app.

## How the tests sign in

- **Agents:** the token of `operator` from `infra/lokal/.agents/operator.token`
  (mode 0600). Grants are set and revoked through the platform MCP. The token
  is never printed.
- **The real gateway:** a Better Auth session for `user@<first allowed domain>`,
  created inside the control-plane container through `lokaleSession`, the same
  way the admin viewing proxy does it (ADR 0014). Hooks run, nothing is
  written with SQL. The cookie only lives in the test process and the browser.
- Traces and videos are off, because a trace would store the token and the
  session. On failure there is only a screenshot.

Each run starts by checking that the user has no grants. The grants it sets
are revoked at the end, also when a step fails. Every review gate run leaves a
`blocked` deployment in the log on purpose.

## CI

`.github/workflows/e2e.yml` only runs on `workflow_dispatch`. The stack builds
the control plane, Postgres and one image per app, and the review gate runs
gitleaks and semgrep. That is too slow and too heavy for every push.
