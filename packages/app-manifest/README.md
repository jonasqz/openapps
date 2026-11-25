# @openapps/app-manifest

The authoritative schema for `app.json` plus the catalog source abstraction.
`docs/04-app-manifest.md` describes the intent, this package the shape. If a
description differs from the code, the code wins.

## What is in it

- `appManifestSchema` — zod schema for `app.json`, `strict` (an unknown field
  is an error, not a silent pass).
- `validateAppManifest(input)` — checks and collects all findings instead of
  throwing at the first. For the review gate.
- `parseAppManifest(input)` / `parseAppManifestJson(text)` — throw
  `ManifestValidationError` with readable paths.
- `appManifestJsonSchema()` and `schema/app.schema.json` — JSON schema for
  agents and tools without TypeScript.
- `CatalogSource` — the interface through which the control plane reads apps.
- `LocalCatalogSource` — the only source in v1.

## Fields

| Field | Why |
| --- | --- |
| `manifestVersion` | Version of the format, not of the app. Currently `1`. |
| `name`, `displayName`, `description`, `category` | Catalog entry. `name` is the slug and the namespace for schema and tools. |
| `version` | Exact semver. No ranges — a deploy is bound to a version. |
| `requiredTables` | Tables in the app's own schema (AGENTS.md rule 2). |
| `offeredTools` | MCP tools, generated from `openapi.yaml` (rule 3). `verb` binds each tool to the permission model. |
| `requestedGrants` | Requested permissions in the one permission model: subject kind, verb, resource. A request, not a grant. |
| `env` | Declared env variables with a `secret` flag (rule 5). Values never appear in the manifest. |
| `egress` | Allowed outbound targets (rule 7). Anything missing here is blocked. |
| `source` | Git URL and tag. |

## The permission model in the manifest

Three axes, the same as in the control plane:

- **Subject kind:** `human`, `group`, `app`, `agent`
- **Verb:** `read`, `write`, `execute`
- **Resource:** `{ kind: 'app' | 'table' | 'view' | 'tool', app, name }`

`subjectId` may be omitted if the group is only known at installation — the
control plane asks for it when granting. Default deny holds in every case: an
entry here opens nothing, it requests.

## The JSON schema

`schema/app.schema.json` is generated from the zod schema at `build`
(`zod-to-json-schema`) and exported as `@openapps/app-manifest/app.schema.json`.
The reason against a hand-maintained schema: the zod schema is the one source
of truth. A second schema by hand would drift with the first new field — and
finding exactly that kind of drift is the review gate's job, not something it
should cause.

## Catalog sources

```ts
const source = new LocalCatalogSource({ directory: '/srv/openapps/catalog' });
const entries = await source.list();
const app = await source.get('projektliste');
```

Expected layout: `<directory>/<app>/app.json`. The `name` in the manifest is
authoritative; if the folder name differs, that is an error. Nothing is
cached — a change takes effect immediately, the same rule as for revoking
grants.

In v1 there is only this source. The interface exists now so that a public
community catalog and private catalogs can be added later without apps or the
control plane changing.

## Scripts

```bash
pnpm --filter @openapps/app-manifest build      # tsc + schema/app.schema.json
pnpm --filter @openapps/app-manifest typecheck
pnpm --filter @openapps/app-manifest test
```
