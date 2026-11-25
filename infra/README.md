# Infrastructure

What lives here runs the platform — it is not part of the product.

State after [ADR 0007](../docs/decisions/0007-eine-domain-pfade-statt-subdomains.md)
(German; one domain, one path per app) and
[ADR 0008](../docs/decisions/0008-eigene-dynamische-konfiguration.md) (German;
the control plane writes its Traefik routers itself). There is no own **static**
Traefik configuration any more; it belongs to Coolify, and we do not touch it.

| Path                                    | What                                                                                                                 |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `scripts/check-auth.sh`                 | Evidence for DoD 2: no app path reachable without a session, before and after every Coolify update                   |
| `scripts/traefik-guard.py`              | The evaluation of the Traefik API for `check-auth.sh`: routers, middlewares, `forwardedHeaders`                      |
| `app-urls.txt.example`                  | Template for the address list that the script checks (one domain, one path per app — ADR 0007)                       |
| `traefik/dynamic/openapps.example.yaml` | **Example**, not to be rolled out: what the generator outputs. On the host the control plane writes this file itself |
| `traefik/deny-backend/`                 | nginx that answers every request with 403. The only thing here that belongs on a host                                |
| `traefik/docker-compose.yml`            | Local stack for the evidence: Traefik in Coolify's static form, deny backend, auth stub, three dummy apps            |
| `traefik/local/`                        | Only for the local run: generator call, stub, dummy app, throwaway certificate, `nachweis.sh`                        |
| `traefik/.env.example`                  | Only ports for the local stack. No secrets                                                                           |
| `betrieb/`                              | The stack for the server: control plane, deny backend, Postgres as one Coolify resource, plus instructions           |

## The biggest assumption

The protection in front of the apps hangs on one file in the dynamic directory
of Coolify's proxy. That Coolify does not touch it during an update is proven
for **v4.7.1** (ADR 0008) and open again for every later version. Therefore:

```bash
infra/scripts/check-auth.sh infra/app-urls.txt   # before the update
# update Coolify
infra/scripts/check-auth.sh infra/app-urls.txt   # afterwards, same list
```

A run without a failure is the evidence. A service that does not answer counts
as a failure — not as protected.

## The gateway: where the protection hangs

**One place, plus the path on which it lands.**

1. `apps/control-plane/src/domain/gateway-config.ts` — the generator. Every
   router it outputs carries the two middlewares
   (`openapps-strip-auth-headers`, then `openapps-forward-auth`), and that hangs
   on the **type**: `GuardedRouter` cannot be constructed outside the file, and
   the only factory does not take the middlewares as a parameter. A router
   without forward auth cannot come into being here.
   The order is part of the security: first delete all `X-Auth-*` of the
   incoming request, then check and set. Swapped, the model from ADR 0004 is
   worthless.
2. The mounted path: `/data/coolify/proxy/dynamic/openapps.yaml` on the host,
   `/traefik/dynamic` in the control plane container (`GATEWAY_DYNAMIC_DIR`).
   It is written atomically — temporary file in the same directory, then
   `rename` — so that Traefik's file provider with `watch` never sees a half
   file. `openapps.yaml` is none of the four file names that Coolify writes
   there itself; the list is in the code as `RESERVED_DYNAMIC_FILENAMES` and
   prevents startup if someone configures one of them.

Three measurements stand next to it. They **set** nothing, they say what is:

- `verify` after every deploy compares the file on the host character by
  character with what the generator would write now (`mismatch` names the
  differing line).
- The startup check (`apps/control-plane/src/infra/gateway-guard.ts`) asks the
  Traefik API: do our two middlewares exist, does **every** router with the
  prefix `openapps-` carry the chain in this order, is it `enabled`, is the
  catch-all there, and is `forwardedHeaders` empty on the entrypoint. A finding
  = alarm, visible in `/healthz`.
- The review gate step `gateway-config` checks before the deploy that a
  supporting configuration can be generated for this app at all.

What there is **no longer** for it: no entrypoint middleware, no `traefik.yml`
of ours, no Traefik labels on the apps. Apps are deployed without a domain;
Coolify then generates not a single Traefik label, and an app becomes reachable
solely via its router in `openapps.yaml`.

### The lost 2 s timeout

Traefik's `forwardAuth` has no timeout option; its HTTP client has 30 s built
in. The old version reached a 2 s timeout by sending the auth request through an
internal entrypoint — and entrypoints live in the static configuration, which
now belongs to Coolify. Measured: a control plane with a 3.5 s response time
gets through with **200**.

This is accepted, not fixed. The alternative would be to put
`/api/authz/forward` on a router without middlewares — a hole in exactly the
layer that ADR 0008 closes. Consequence: the gap lets nothing unapproved
through, but extends the window in which a hanging control plane blocks the
gateway from 2 s to 30 s. In the code it is `GATEWAY_TIMEOUT_NOTE`, in the
protocol case 8.

## Running the local evidence

```bash
cd infra/traefik
./local/make-certs.sh                 # throwaway certificate for *.local.test
./local/konfiguration-erzeugen.sh     # openapps.yaml with the real generator
docker compose up -d
./local/nachweis.sh                   # nine cases, exit code 1 on failure
docker compose down
```

The stack needs no control plane: `local/control-plane-stub.py` answers 200,
302, 403 or deliberately too slowly, depending on the path. The dummy apps
return which `X-Auth-*` headers arrived at them — the proof for cases 1 and 4
hangs on that.

What is checked is the **generated** configuration, not a replica:
`local/konfiguration-erzeugen.sh` calls `buildGatewayConfig()` and
`renderGatewayConfig()` from the control plane. Traefik runs with command-line
arguments that replicate Coolify's defaults (entrypoints `http` and `https`,
file provider with `watch`, no Docker provider, no Docker socket). Locally only
a self-signed default certificate is added, because Let's Encrypt issues
nothing for `.local.test`.

`local/nachweis.sh` checks the chain, `scripts/check-auth.sh` checks a list of
real addresses. One does not replace the other.

The run that results is stored as
`docs/nachweise/dod-02-laeufe/2026-11-09-lokal-eigene-konfiguration.txt`
(German). Case 8 is a **failure** in it — the lost timeout, see above.

## After a Coolify update

```bash
infra/scripts/check-auth.sh infra/app-urls.txt    # measure first, do not repair
```

If the run fails or an app path answers with 200, then in this order:

1. Check whether the file is still there:
   `ls -l /data/coolify/proxy/dynamic/openapps.yaml`.
2. `curl http://<traefik>:8080/api/http/routers` and check whether every router
   with the prefix `openapps-` still carries
   `["openapps-strip-auth-headers@file","openapps-forward-auth@file"]`, in this
   order, and has `status: enabled`. The startup check of the control plane asks
   the same endpoint; its result is in `/healthz`.
3. If something is missing or deviates: let the control plane trigger a deploy
   (every deploy rewrites the file completely) or restart it. Editing by hand is
   the path that triggers the lint, not the one that calms it.
4. `check-auth.sh` again. Only a run without a failure is the release.

If the file is missing entirely, that is measured **not** a hole: without it no
router with our prefix exists, no app path is reachable, and the startup check
reports "no router with the prefix `openapps-`". Loud in the log, closed to the
outside.

The update itself is no reason to bring a repair forward: the run is meant to
show what the update does on its own (spec 4.3).

Step 2 by hand is only needed if you want to watch: the second part of
`check-auth.sh` checks exactly this, via `scripts/traefik-guard.py`. It goes
over **every** router with the prefix `openapps-` that the API names, not over a
list of expected names — and additionally over `forwardedHeaders` on the
entrypoint, which now belongs to Coolify. The startup check of the control plane
makes the same checks; `tests/traefik-guard-skript.spec.ts` keeps both versions
on the same verdict.

## What is still needed on the host

The finished stack for it is in [`betrieb/`](betrieb/README.md): service
definition for Coolify, Dockerfiles and the steps for the first start.

- The control plane runs on the **same** server as Coolify's proxy, and
  `/data/coolify/proxy/dynamic` is mounted into its service definition (in the
  container `/traefik/dynamic`). If the mount is missing, the first deploy fails
  with an error that names the directory — not silently. This path does not
  cover several servers (ADR 0008).
- The deny backend from `traefik/deny-backend/` runs in the proxy's network
  under the alias that `GATEWAY_DENY_BACKEND_URL` names (default
  `http://openapps-deny-backend:8080`). Without it an unknown path lands in
  Traefik's 404 instead of a clear no.
- A Docker network in which proxy, control plane and apps live together
  (`GATEWAY_DOCKER_NETWORK`, default `coolify`). The services point to **network
  aliases**, not to container names: the latter carry a timestamp suffix and
  change on every deploy.
- Env of the control plane that goes into the configuration: `APPS_DOMAIN`,
  `CONTROL_PLANE_HOST`, `CONTROL_PLANE_SERVICE_URL`, `FORWARD_AUTH_ADDRESS`,
  `GATEWAY_ENTRYPOINT` (default `https`, Coolify's name), `GATEWAY_CERT_RESOLVER`
  (default `letsencrypt`, from Coolify's static file), `TRAEFIK_API_URL`.
- The Traefik API (port 8080) must not go onto the internet. Coolify's proxy
  publishes the port, the dashboard runs with `api.insecure=false` — a firewall
  question. If the control plane is in the proxy network, it reaches the API
  without a mapping.
