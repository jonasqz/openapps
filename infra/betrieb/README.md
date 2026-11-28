# Going live on a server with Coolify

For exactly one server: Coolify's proxy, the control plane and all apps on the
same machine (ADR 0008). The assumption is tested against Coolify **v4.7.1**. A
fresh run on a real server is still outstanding. What has to be checked there is
listed below under "First start".

The stack is [`docker-compose.yml`](docker-compose.yml): control plane, deny
backend and Postgres, as **one** resource in Coolify.

## Server size

Coolify itself wants at least 2 vCPU and 2 GB RAM. Building the image
(`next build` and the installation of semgrep) briefly needs more. Below 4 GB
RAM, create swap before the first deploy, otherwise the build aborts with
"Killed":

```bash
fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

## 1. Beforehand on the server

```bash
stat -c '%u %a' /data/coolify/proxy/dynamic
```

Expected: `9999 700`. The control plane runs in the container as UID 9999 and may
write into this directory only for that reason. If a different UID is shown
there, set the build argument `RUNTIME_UID` to that value in Coolify. Do **not**
loosen the permissions on the host. The next Coolify update resets them, and
then writing fails (loudly, but only then).

## 2. What you create outside

| What                                                                                                        | Where                                     | Value for the env                                      |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------ |
| DNS: two A records pointing to the server's IP                                                              | your DNS provider                         | `CONTROL_PLANE_HOST`, `APPS_DOMAIN`                    |
| Email for Let's Encrypt                                                                                     | Coolify → Server → Proxy                  | —                                                      |
| OAuth client (type "Web application"), redirect URI `https://<CONTROL_PLANE_HOST>/api/auth/callback/google` | Google Cloud Console → APIs → Credentials | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`             |
| API token with `root` or `read:sensitive` + `write` + `deploy`                                              | Coolify → Keys & Tokens                   | `COOLIFY_API_TOKEN`                                    |
| UUID of the project and the server in which the apps land                                                   | Coolify, shown in the URL of the page     | `COOLIFY_PROJECT_UUID`, `COOLIFY_SERVER_UUID`          |
| Token with access to the app repos and the starter template                                                 | GitHub → Settings → Developer settings    | `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_TEMPLATE_REPO` |

You enter secrets **only** in Coolify, not in a chat and not in the repo. You
generate random values on the server:

```bash
openssl rand -base64 48 | tr -d '\n=+/' ; echo
```

One each for `OPENAPPS_AUTH_MASTER_SECRET`, `BETTER_AUTH_SECRET`,
`OPENAPPS_OWNER_PASSWORD` and `POSTGRES_SUPERUSER_PASSWORD`.

## 3. The resource in Coolify

1. Project → **New Resource** → Repository (private via the GitHub app or via
   deploy key) → this repo, branch `main`.
2. Build pack: **Docker Compose**. Compose file:
   `/infra/betrieb/docker-compose.yml`.
3. Give **none** of the three services a domain. The control plane writes the
   router itself. A router from Coolify would not carry our middlewares.
4. Environment: all variables that Coolify shows as required.
   `AUTH_ALLOWED_EMAIL_DOMAINS` is the domain of your company addresses,
   `AUTH_BOOTSTRAP_ADMINS` is your own address.
5. Deploy.

## 4. First start: what to check

On the server, in this order. Every step has an expected output. If it
deviates, do not continue.

```bash
# Find the container name of the control plane
CP=$(docker ps --format '{{.Names}}' | grep control-plane | head -1)

# a) Migrations ran, file written
docker logs "$CP" 2>&1 | grep -E 'applied|no new migration|gateway configuration|ALARM|WARN'
#    expected: "applied: 0001_… 0015_…" and "gateway configuration written: 2 router(s)."
#    (control plane and catch-all; every app adds one more)

# b) The file lies next to the proxy
ls -l /data/coolify/proxy/dynamic/openapps.yaml

# c) Traefik reaches the control plane via the alias
docker exec coolify-proxy wget -qO- http://openapps-control-plane:3000/healthz
#    expected: "ok"

# d) From outside: no way through without a session
curl -sI https://<CONTROL_PLANE_HOST>/            # expected: 302 to /login
curl -sI https://<CONTROL_PLANE_HOST>/login       # expected: 200
curl -skI https://<APPS_DOMAIN>/irgendwas         # expected: 403 or 302, never 200

# e) Can the control plane read the Traefik API? (startup check)
docker logs "$CP" 2>&1 | grep -E 'gateway protection'
```

On **d)**: for `APPS_DOMAIN` there is no Let's Encrypt certificate until the
first app has a router. The catch-all deliberately requests none. Until then
Traefik serves its default certificate, hence `-k`.

On **e)**: Coolify starts Traefik with `api.insecure=false`. Whether the API
answers at `http://coolify-proxy:8080` at all then is **not proven**. If it does
not answer, the startup check reports "cannot be checked" (a warning, not an
alarm). The protection then still holds, but the ongoing measurement is missing,
and `check-auth.sh` only checks the first part. That is the first finding this
run is meant to deliver.

Afterwards you sign in at `https://<CONTROL_PLANE_HOST>` with Google. If your
address is in `AUTH_BOOTSTRAP_ADMINS`, you land in `platform-admins`.

## 5. Connecting an agent

1. In the control plane under **Agents**, create an identity (or via API:
   `POST /api/agents`). The token is shown exactly once.
2. Give the agent grants. Without a grant it sees nothing and may do nothing.
3. Connect, here with Claude Code:

```bash
claude mcp add --transport http openapps https://<CONTROL_PLANE_HOST>/mcp --header "Authorization: Bearer <token>"
```

Every other MCP client works the same way, as long as it sets a fixed header.
Checking without a client:

```bash
curl -si https://<CONTROL_PLANE_HOST>/mcp -X POST -H 'content-type: application/json' -d '{}' | head -1
#    expected: 401
```

Disabling takes effect on the next call (`disable_agent` or the button on the
page).

## 6. The first app

Via MCP: `create_app`, push, `request_deploy` with version and commit. The
control plane fetches the commit itself from the repo backend, checks it and
deploys. A path on the caller's machine is not needed.

- The `GITHUB_TOKEN` needs read permission on the contents of the app repos for
  this.
- Coolify can only clone private app repos if a GitHub app is connected under
  **Sources**. Its UUID belongs in `COOLIFY_GITHUB_APP_UUID`. Empty means: only
  public repos.
- `COOLIFY_GIT_BRANCH` is the branch that Coolify clones (default `main`). What
  gets built is always exactly the checked commit.

## 7. Database extensions (pgvector, once per server)

Apps that list `databaseExtensions: ["vector"]` in `app.json` (Knowledge from
0.3.0 on, [ADR 0025](../../docs/decisions/0025-knowledge-als-optionales-rag.md),
German) need pgvector in the schema `extensions` of the database `openapps`.
The Postgres image of this stack brings the package; creating the extension
needs the **superuser**, which the control plane deliberately does not have.
On a fresh volume the init script `20-vector.sh` does it by itself. On a server
whose volume already exists, run this **once, before the first deploy of an
app with `databaseExtensions`**, after Coolify has redeployed the stack with
the new image:

```bash
PG=$(docker ps --format '{{.Names}}' | grep postgres | grep -v coolify | head -1)
docker exec "$PG" openapps-vector
#    expected: "openapps-vector: vector 0.8.… in schema extensions of database openapps"

# check: the control plane role may pass on USAGE, but has no CREATE there
docker exec "$PG" psql -U postgres -d openapps -tA -c \
  "SELECT has_schema_privilege('openapps_owner', 'extensions', 'USAGE WITH GRANT OPTION'),
          has_schema_privilege('openapps_owner', 'extensions', 'CREATE')"
#    expected: "t|f"
```

A second run changes nothing. The control plane then gives an app role
`USAGE` on `extensions` on every deploy whose manifest asks for it, never
`CREATE`, and takes it away again when the manifest no longer asks. If the
step was forgotten, the deploy ends as `failed` with a message that names
`openapps-vector`; the running version stays live. Without a model configured
(ADR 0024) Knowledge 0.3 still only searches with full text, but it needs the
extension all the same: its migration creates the vector column.

## What is deliberately still missing here

- **A run against a real Coolify.** The adapter is written against the source
  code of Coolify v4.7.1 and tested against doubles. The first real deploy of an
  app is the proof that is missing.
- **Backups.** The volume `openapps-postgres` holds grants, audit log, groups
  and agent identities. Coolify does not back it up by itself.
- **OAuth for MCP.** Today only a bearer token in the header
  ([ADR 0009](../../docs/decisions/0009-plattform-mcp-im-selben-container.md),
  German).
