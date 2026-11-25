# @openapps/control-plane

The only app of the layer that we build ourselves. It keeps the register of
apps, holds **the one** permission model, runs the review gate, writes the audit
log and controls the deploy and repo backends.

## Layout

```
migrations/              numbered ascending, forward only, never changed
src/domain/              domain logic — no HTTP, no vendor names
  can.ts                 the one permission check (default-deny, no cache)
  apps.ts                createApp (creates the repo), listApps
  deployments.ts         requestDeploy, rollback, env and gateway per app
  grants.ts              grant, revoke
  gateway-headers.ts     the five identity headers, signed via the SDK
  gateway-identity.ts    app id and host — one source for signature and env
  app-secret.ts          OPENAPPS_AUTH_SECRET per app, derived
  manifest-grants.ts     translation manifest → permission model (`human` → `user`)
  review-gate/           pipeline, steps, merging
src/adapters/coolify/    the only place that knows Coolify
src/adapters/github/     the only place that knows GitHub
src/infra/pg/            repositories, provisioner, migration runner
src/infra/memory/        in-process storage plus doubles (tests, development)
src/lib/                 env, session, HTTP mapping, composition
src/app/api/             route handlers — they only call the domain
src/app/                 two pages: apps and grants
tests/                   the risky paths (DoD 1, 3, 4, 5)
docker-compose.yml       test Postgres for the evidence on DoD 3
```

## The five rules of this package

1. **Agents first.** Every action is a domain function first, then an endpoint
   and MCP tool, and a button last. `src/app/api` contains no logic.
2. **Default-deny.** `can` returns `false` as long as no matching, unrevoked
   grant exists. There is no branch without a grant.
3. **No cache over grants.** Every check asks the store, so that a revocation
   takes effect immediately (DoD 3).
4. **Coolify and GitHub only in the adapter.** Outside `src/adapters/*` the
   names do not appear. If one of them does not hold up, we replace a folder.
5. **One implementation per format.** The signature of the identity headers
   comes from `@openapps/sdk` (`signatureFor`). This app does not rebuild it —
   two implementations of the same format drift apart, and they do so silently.

## Forward auth and the five headers

`GET /api/authz/forward` is the route that Traefik asks on every request (spec
`docs/specs/woche-1-forward-auth.md` section 1.1, German). On 200 it sets:

| Header              | Content                                                 |
| ------------------- | ------------------------------------------------------- |
| `X-Auth-User-Id`    | User id from Better Auth                                |
| `X-Auth-User-Email` | Email                                                   |
| `X-Auth-Groups`     | Groups, comma-separated                                 |
| `X-Auth-Issued-At`  | Unix seconds of the decision                            |
| `X-Auth-Signature`  | HMAC-SHA256, hex, over app id, host and the four values |

All five are always set, even if empty. The Traefik labels from
`src/adapters/coolify/traefik.ts` first remove all `X-Auth-*` headers that came
with the request (`openapps-strip-<app>`) and then take over exactly these five
from the response — ADR 0004 names forgetting this step as the point where the
model becomes worthless. `missingForwardAuthLabels()` is the basis for the label
lint from the spec.

### The secret per app

`OPENAPPS_AUTH_SECRET` differs per app and is **not stored** but derived:
HKDF-SHA256 from `OPENAPPS_AUTH_MASTER_SECRET`, the app id and
`apps.auth_secret_generation`. Consequences:

- No app secret lies in the database.
- Rotating one app: increment the generation, redeploy.
- Rotating all apps: new master secret.
- The master secret is the one point everything hangs on. It lives only in the
  env of the control plane and never goes into an app.

For every deployment the control plane sets these in the env **of the app**:
`DATABASE_URL`, `DATABASE_SCHEMA`, `OPENAPPS_APP_ID`, `OPENAPPS_APP_HOST` and
`OPENAPPS_AUTH_SECRET`. App id and host come from
`src/domain/gateway-identity.ts` — the same functions that also sign. Only that
makes them byte-identical.

## Repo backend

`create_app` creates the repo before it registers. If that fails, nothing is
registered. The adapter lives in `src/adapters/github` and copies the starter
template (`POST /repos/{template}/generate`, no fork).

**Permissions the token needs** (`GITHUB_TOKEN`):

- _Fine-grained token_ on the organisation from `GITHUB_OWNER`:
  `Administration: Read and write` (create repos) and
  `Contents: Read and write`. The template repo must be readable by the token
  and marked as a template.
- _Classic token_: `repo`. For an organisation, the organisation must
  additionally approve the token.

The adapter needs nothing more: no `delete_repo`, no `workflow`, no permissions
on other organisations. Which token type to use is the user's decision.

## Operation

```bash
pnpm --filter @openapps/control-plane migrate   # migrations, forward only
pnpm --filter @openapps/control-plane dev       # development
pnpm --filter @openapps/control-plane test      # DoD tests
```

Variables are listed in `.env.example`. Secrets never go into the code.

## Evidence

| File                              | Criterion                                                                                                                                                   |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/create-app.spec.ts`        | DoD 1: the repo exists before registration; if it fails, nothing is registered                                                                              |
| `tests/grants.spec.ts`            | DoD 3 in the permission model: blocked → grant → readable → revocation → blocked                                                                            |
| `tests/grants-postgres.spec.ts`   | DoD 3 in Postgres, as a non-superuser role like in operation: foreign schema blocked, the `search_path` trick fails, no role with `rolsuper`/`rolbypassrls` |
| `tests/review-gate.spec.ts`       | DoD 4: an embedded secret blocks; a Claude report alone never approves                                                                                      |
| `tests/deployments.spec.ts`       | DoD 5: rollback swaps the pointers, backend called exactly once                                                                                             |
| `tests/gateway-start.spec.ts`     | ADR 0008: `openapps.yaml` is created at startup, even without an app — otherwise there would be no login                                                    |
| `tests/gateway-signature.spec.ts` | the seam to the SDK: `getUser` accepts the signature of the control plane and rejects every deviation                                                       |

### Tests against a real Postgres instance

```bash
docker compose -f apps/control-plane/docker-compose.yml up -d
pnpm --filter @openapps/control-plane test
docker compose -f apps/control-plane/docker-compose.yml down -v
```

Without a running instance these tests skip themselves (`describe.skipIf`) and
say so visibly. A missing container is missing evidence, not a failed test —
`pnpm check` stays green on a machine without Docker.
