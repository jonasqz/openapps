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

Two more pairs with their own signatures follow: `X-Auth-Nav` and
`X-Auth-Nav-Signature` for the shared sidebar (ADR 0017), and
`X-Auth-Readable-Apps` and `X-Auth-Readable-Apps-Signature` with the apps the
caller may read (ADR 0020). The readable apps are only filled for apps whose
manifest requests `gatewayContext: ["readableApps"]`; for all others both are
empty. All nine are removed from incoming requests.

## App calls

`POST /api/apps/<app>/tools/<tool>` lets one app call a tool of another app
(ADR 0020). It accepts no session, only the signature of the calling app
(`X-OpenApps-Caller`, `-Issued-At`, `-Signature`, made with its
`OPENAPPS_CALL_SECRET`), and it is not in the list of public paths, so it is
only reachable inside the platform network. The caller becomes the subject
`app:<name>`; grant check, audit entry `call_app_tool` and forwarding are the
same function the platform MCP uses for agents (`domain/app-tools.ts`,
`infra/app-tool-invoker.ts`). The logic is in `src/lib/app-call.ts`, the tests
in `tests/app-call.spec.ts`.

### The secret per app

`OPENAPPS_AUTH_SECRET` differs per app and is **not stored** but derived:
HKDF-SHA256 from `OPENAPPS_AUTH_MASTER_SECRET`, the app id and
`apps.auth_secret_generation`. `OPENAPPS_CALL_SECRET` is derived the same way
with its own context, so the key for outgoing app calls is not the key of the
gateway signature. Consequences:

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

## Search across all apps

`GET /api/search?q=…&apps=…&limit=…` searches all apps the caller may search
and groups the hits by app (ADR 0021, `domain/platform-search.ts`). It takes
the person from the session only. The same route answers on the shared app
domain as `/_platform/search` (Next rewrite), so the bar in the browser calls
it on its own origin: the generator writes a router `openapps-platform` for
`/_platform/` with the same two middlewares as every router, and the forward
auth lets exactly `/_platform/search` through, with a session (401 without),
without identity headers. A person searches apps they have `read` on; an
agent (MCP tool `search`) also needs `execute` on the app's search tool. Each
app gets 2 s; one that times out or fails is listed under `failed`. One audit
entry `search` per search, without the query text. Logic in
`src/lib/platform-search-http.ts`, tests in `tests/platform-search.spec.ts`
and `tests/platform-search-http.spec.ts`. Locally, the viewing proxy on 8090
answers `/_platform/search` itself, as the viewer (`ansichtSearch`).

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
