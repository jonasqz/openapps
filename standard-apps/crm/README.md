# CRM

Standard app of openapps: a lean CRM for humans and agents. Companies,
contacts, deals with a pipeline, and activities. Lives under `/crm`.

## Tools

Every function is a tool first (`POST /crm/api/tools/<name>`), described in
`openapi.yaml` and `app.json`. The UI calls the same handlers.

| Tool | Verb | What |
| --- | --- | --- |
| `companies.list` | read | Companies, optionally with search `q` |
| `companies.get` | read | Company with contacts, deals and the latest 20 activities |
| `companies.create` | write | Create a company |
| `contacts.list` | read | Contacts, search `q`, filter `companyId` |
| `contacts.get` | read | Contact with deals and activities |
| `contacts.create` | write | Create a contact, email is unique |
| `contacts.update` | write | Update a contact, `null` clears a field |
| `deals.list` | read | Deals, filter `stage`, `companyId` |
| `deals.create` | write | Create a deal, amount in cents |
| `deals.update_stage` | write | Set the stage, logs an activity automatically |
| `activities.log` | write | Log a note, call, email or meeting |
| `activities.list` | read | History, newest first |
| `pipeline.summary` | read | Count, total and weighted total per stage |

## Stages and activity kinds

Stages and activity kinds are fixed API and database values:

- Stages: `lead`, `qualified`, `proposal` (open), `won`, `lost` (closed)
- Activity kinds: `note`, `call`, `email`, `meeting`

A stage change logs an activity of kind `note`.

## Pages

| Path | What |
| --- | --- |
| `/` | Pipeline |
| `/companies`, `/companies/new`, `/companies/<id>` | Companies |
| `/contacts`, `/contacts/new` | Contacts (`?q=`, `?company=`) |
| `/deals/new`, `/deals/stage` | Create a deal, change a stage |
| `/activities/new` | Log an activity |

## Layout

- `migrations/0001_crm.sql` — tables, checks, indexes
- `migrations/0002_english_values.sql` — English values: column `industry`,
  stages and activity kinds
- `seeds/0001_beispieldaten.sql` — four made-up companies with contacts,
  deals and activities (local only)
- `src/instrumentation.ts` — applies the migrations on start
- `src/lib/schemas.ts` — arguments of every tool (zod, strict)
- `src/lib/crm.ts` — data access
- `src/lib/pipeline.ts` — pipeline calculation as a pure function
- `src/lib/tools.ts` — the tool table, used by the route and the UI
- `src/app/api/tools/[tool]/route.ts` — `createToolRoute`
- `src/app/actions.ts` — server actions of the forms, they call the tools

## Tests

```bash
pnpm test
```

The test against a real Postgres (`src/lib/crm.db.test.ts`) only runs with
`CRM_TEST_DATABASE_URL` and `CRM_TEST_DATABASE_SCHEMA`. It needs an empty
schema owned by the app role, and a role without `SUPERUSER` and
`BYPASSRLS`:

```sql
create role app_crm login password '…' nosuperuser nobypassrls;
create schema app_crm authorization app_crm;
```

## Local

```bash
cp .env.example .env
pnpm dev
```

Without the gateway there is no user. Tool calls and forms need the five
`X-Auth-*` headers, signed with `signatureFor` from `@openapps/sdk`, and an
`X-Forwarded-Host` equal to `OPENAPPS_APP_HOST`.
