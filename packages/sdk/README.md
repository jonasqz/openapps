# @openapps/sdk

The client every app on the platform uses. Purpose: an app contains no auth
and no permission code (CLAUDE.md principle 3, AGENTS.md rules 1 and 2). The
gateway checks every request, the DB role limits every access — this package
is where an app uses both correctly.

## The user from the gateway headers

```ts
import { getUser } from '@openapps/sdk';

export async function GET(request: Request) {
  const user = getUser(request.headers); // throws if the request did not come from the gateway
  return Response.json({ id: user.id, groups: user.groups });
}
```

`getUser` reads the five identity headers the gateway sets — but **only** if
the signature over them is valid. Otherwise it throws `UntrustedRequestError`
(status 401). There is no anonymous user and no fallback.

| Header | Content |
| --- | --- |
| `X-Auth-User-Id` | Stable id of the user |
| `X-Auth-User-Email` | Email from Google SSO |
| `X-Auth-Groups` | Groups, comma-separated |
| `X-Auth-Issued-At` | Unix time of the decision, in seconds |
| `X-Auth-Signature` | HMAC-SHA256 over the four values above plus host and app id |

All five are always set, even with empty values (spec 3.1). An empty but
correctly signed user is rejected — a signed "nobody" is not a user.

The signal is deliberately an HMAC over the identity values and not a shared
secret: a token only proves that *some* request came from the gateway, not
that *these* user values came from the gateway (ADR 0004).

### The signature material

Gateway and app must build the material **byte for byte** identically,
otherwise the check is a coin toss. Six fields in exactly this order, each with
a length prefix in UTF-8 bytes:

```
openapps-forward-auth/1\n
<bytes>:<app-id>\n
<bytes>:<host>\n
<bytes>:<x-auth-user-id>\n
<bytes>:<x-auth-user-email>\n
<bytes>:<x-auth-groups>\n
<bytes>:<x-auth-issued-at>\n
```

Example:

```
openapps-forward-auth/1
12:projektliste
26:projektliste.apps.blyck.de
7:usr_123
14:jonas@blyck.de
11:team,admins
10:1762680000
```

- The values go in **unchanged**, exactly as they arrive as header values: not
  trimmed, not lowercased, groups not sorted. Any normalisation would have to
  be done identically by the gateway.
- `host` is always the app's own domain from `OPENAPPS_APP_HOST`, never the
  host from the request. A signature for another domain therefore does not
  match.
- Length prefixes instead of separators, because any separator makes field
  boundaries shiftable: `usr_12` + `3jonas@blyck.de` and `usr_123` +
  `jonas@blyck.de` would be the same material if naively concatenated — two
  identities, one proof.
- The key is the UTF-8 bytes of `OPENAPPS_AUTH_SECRET`, the output is lowercase
  hex. The comparison is constant-time.

`signatureFor()` and `signatureMaterial()` are exported so that the control
plane uses the same function instead of rebuilding it.

### What is checked in addition

1. `X-Auth-Issued-At` is at most 60 s in the past and not in the future. The
   window (`maxAgeSeconds`), the lead (`futureToleranceSeconds`) and the clock
   source (`now`) are injectable.
2. If the request is visibly addressed to another domain (`X-Forwarded-Host`,
   otherwise `Host`), it is rejected with a clear message before the signature
   is checked. The host from the request is never the source of truth — it is
   only compared.

### Assumptions about the infrastructure

Relevant for the Traefik forward auth:

1. The gateway sets all five identity headers on every request to an app —
   always, even with empty values.
2. The gateway **removes** all `X-Auth-*` headers of the incoming request
   before it sets its own. That applies to all five, not just the signature:
   if a Traefik label forgets this, Traefik passes a header sent by the client
   through unchanged, and the model is worthless. This belongs in the
   regression tests and in the label lint.
3. Gateway and app know the same secret: the control plane generates it per
   app and passes it only as an env variable into that app and the gateway. At
   least 32 characters, otherwise the app serves no request. Rotation means a
   redeploy — there is deliberately no transition path with two secrets.
4. Gateway and app have roughly the same clock. If it drifts by more than the
   window, nobody gets through — an outage, not a hole, but it must be
   monitored.

### What the HMAC does not do

It proves origin and integrity of the values, **not** that nobody is
listening. Headers and signature travel in plain text from gateway to app;
anyone who can listen there knows the user's identity and can reuse the
signature within the window for the same domain. Only the network separation
from spec 3.3 (no published host port, only the gateway network) or TLS on that
leg protects against that. Nor does it protect against a leaked secret —
whoever knows it can sign arbitrary user values.

## The shared sidebar

The sidebar of every app (`PlatformShell`, ADR 0017) needs the user and the
platform navigation. Both come from the gateway headers; `getNavigation`
checks the separate signature of `X-Auth-Nav` and returns `null` if anything
is off.

In a Next.js app (App Router) do not read them yourself. Use `loadShell`
from the subpath `@openapps/sdk/next` in `src/app/layout.tsx` and pass the
result to `NextPlatformShell` from `@openapps/ui/next` (ADR 0019):

```tsx
import { loadShell } from '@openapps/sdk/next';
import manifest from '../../app.json';

const shell = await loadShell(manifest); // { appName, appTitle, platform, user, basePath }
```

- Server only. The secret never reaches the browser; importing it in a client
  component fails the build, because `next/headers` is not available there.
- Never throws because of the headers: without a valid identity `user` is
  `null` (the sidebar shows a placeholder), without a valid navigation
  `platform` is `null` (the sidebar shows only this app). Whether a person may
  see the page was decided by the forward auth; route handlers still call
  `getUser` themselves.
- `basePath` comes from `OPENAPPS_APP_BASE_PATH`, the same value
  `next.config.js` bakes into the build. An invalid value falls back to `''`.

`next` is an optional peer dependency: only `@openapps/sdk/next` imports it.
Without Next.js, call `readShell(headers, manifest)` from `@openapps/sdk`
with the request headers — same result, no framework.

## Postgres client

```ts
import { createAppPool } from '@openapps/sdk';

const pool = createAppPool(); // DATABASE_URL + DATABASE_SCHEMA from the env
const { rows } = await pool.query('select id, name from projects order by name');
```

- `search_path` is fixed as a startup option of the connection
  (`-c search_path=<schema>`), not via `SET` afterwards: it applies from the
  first statement. `public` is deliberately not on the path — otherwise an
  unqualified name silently hits someone else's table.
- A connection string that looks like an owner or superuser role (`postgres`,
  `root`, `*_owner`, `*_admin`, …) is rejected before connecting. With
  `expectedRole` the control plane can pin the role it created.
- An `options=` or `search_path=` in the URL is an error: the SDK sets the
  `search_path`, not the env (rule 2, no `search_path` trick).

The actual boundary is drawn by Postgres. This module is the hurdle in front of
it, so that a misconfigured env shows up at startup and not only when an app
reads another app's data.

## Errors

| Error | Status | Meaning |
| --- | --- | --- |
| `UntrustedRequestError` | 401 | Signal or user headers are missing or invalid. |
| `SdkConfigurationError` | 500 | The app is misconfigured (missing or weak env). |
| `ToolInputError` | 400 | The arguments of a tool call are invalid. |
| `ToolNotFoundError` | 404 | The tool call refers to something that does not exist. |

All inherit from `SdkError` and carry `status`, which an app can return
unchanged as the HTTP status.

## Env

| Variable | Secret | Purpose |
| --- | --- | --- |
| `OPENAPPS_AUTH_SECRET` | yes | HMAC key for the identity headers. At least 32 characters. |
| `OPENAPPS_APP_ID` | no | App id in the signature material. |
| `OPENAPPS_APP_HOST` | no | The app's own domain in the signature material. |
| `OPENAPPS_APP_BASE_PATH` | no | The path the app lives under (`/<app>`); empty locally. Read by `loadShell`. |
| `DATABASE_URL` | yes | Connection with the app's own DB role. |
| `DATABASE_SCHEMA` | no | The app's own schema. |

Every app declares these six in its `app.json` (AGENTS.md rule 5).

## Scripts

```bash
pnpm --filter @openapps/sdk build
pnpm --filter @openapps/sdk typecheck
pnpm --filter @openapps/sdk test
```
