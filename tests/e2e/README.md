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

| Spec                      | Path                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin.spec.ts`           | Admin area on `127.0.0.1:8091`: as admin reachable with the Admin link, `/settings` shows the person; as user no Admin link, `/settings` shows the user; the user cannot grant or create agents; foreign origins are rejected.                                                                                                                                                                                                                |
| `gateway-access.spec.ts`  | The real path through Traefik and forward auth (`https://apps.local.test:8443`): no session means login, no grant means 403, a grant opens the app, the bar lists only granted apps, switching works, revoking takes effect on the next request, forged `X-Auth-*` headers are not believed.                                                                                                                                                  |
| `view-proxy.spec.ts`      | Apps viewing proxy on `127.0.0.1:8090`: the bar lists the deployed apps and switches between them, forged identity and navigation headers are dropped.                                                                                                                                                                                                                                                                                        |
| `review-gate.spec.ts`     | Review gate over the platform MCP: a manifest with the wrong version, a manifest that does not match the code and an invalid manifest are blocked, and the live deployment stays the same.                                                                                                                                                                                                                                                    |
| `shared-search.spec.ts`   | Shared search (ADR 0020): a wiki page created over MCP shows up in Knowledge through the outbox and the app call, found by a German word form; an agent without `read` on the wiki does not see it until granted; archiving removes it. Skipped unless wiki 0.3.0 and knowledge 0.2.0 are live.                                                                                                                                               |
| `platform-search.spec.ts` | Search across all apps (ADR 0021): an agent gets an app only with `read` on the app and `execute` on its search tool; `/_platform/search` on the app host is 401 without a session, also with forged headers, other `/_platform/` paths are 403; a person sees only apps they may read; in the bar on 8090 the hits appear grouped by app and a click opens one. Skipped unless CRM and Tasks 0.3.0, wiki 0.3.2 and knowledge 0.2.2 are live. |

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
