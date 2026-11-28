# CRM

Standard app of openapps: a CRM for humans and agents. Companies, contacts,
deals on a pipeline board with stages and close reasons, a timeline of
activities, and next steps with due dates. Lives under `/crm`.

Everything a person can do here, an agent can do through the same tools.

## Tools

Every function is a tool first (`POST /crm/api/tools/<name>`), described in
`openapi.yaml` and `app.json`. The UI calls the same handlers; there is no
second way into the data.

| Tool                  | Verb  | What                                                                                         |
| --------------------- | ----- | -------------------------------------------------------------------------------------------- |
| `companies.list`      | read  | Companies, optionally with search `q`                                                        |
| `companies.get`       | read  | Company with contacts, deals, the latest 20 activities and open next steps                   |
| `companies.create`    | write | Create a company                                                                             |
| `contacts.list`       | read  | Contacts, search `q`, filter `companyId`                                                     |
| `contacts.get`        | read  | Contact with deals, activities and open next steps                                           |
| `contacts.create`     | write | Create a contact, email is unique                                                            |
| `contacts.update`     | write | Update a contact, `null` clears a field                                                      |
| `deals.list`          | read  | Deals, search `q`, filter `stage`, `status` (open/closed), `companyId`, `contactId`, `owner` |
| `deals.get`           | read  | Deal with the latest 50 activities and all next steps                                        |
| `deals.create`        | write | Create a deal in an open stage, amount in cents                                              |
| `deals.update`        | write | Title, value, expected close, owner, contact; never the stage                                |
| `deals.update_stage`  | write | Move to a stage; won and lost need the reason (`note`); logs an activity                     |
| `next_steps.list`     | read  | Next steps, `status` open (default), overdue, done, all; filters like above                  |
| `next_steps.create`   | write | Plan a next step with `dueOn` on a deal, company or contact                                  |
| `next_steps.complete` | write | Mark done, logs `Done: <title>` to the timeline                                              |
| `next_steps.reopen`   | write | Undo a completion, logs `Reopened: <title>`                                                  |
| `activities.log`      | write | Log a note, call, email or meeting                                                           |
| `activities.list`     | read  | History, newest first                                                                        |
| `pipeline.summary`    | read  | Count, total and weighted total per stage                                                    |
| `search`              | read  | Companies, contacts and deals at once (`query`, `limit`); the CRM's tool for the search across all apps (ADR 0021) |
| `crm.resolve`         | read  | Title, path and status of companies, contacts, deals, activities and next steps for chips in other apps (ADR 0023) |

## Rules agents can rely on

- **Stages:** `lead`, `qualified`, `proposal` are open; `won`, `lost` are
  closed. A deal is created open. Only `deals.update_stage` changes the stage,
  so every change is in the timeline as `Stage: Old → New`.
- **Close reason:** moving to `won` or `lost` requires `note`. It becomes
  `closeReason`, and the database sets `closedAt`. Moving back to an open
  stage clears both. Repeating a move to the same stage changes nothing and
  logs nothing.
- **Next steps:** `overdue` means not done and due before today in
  Europe/Berlin. Completing and reopening each log one activity; repeating
  them changes nothing. Each deal shows its earliest open step as `nextStep`.
- **Activity kinds:** `note`, `call`, `email`, `meeting`. Automatic entries
  are `note`.
- **Events (0.4.0, ADR 0022):** the CRM reports `deal.won` and `deal.lost` to
  the deal owner, `next_step.assigned` when someone plans a step for another
  person, and `next_step.due` once per due date when an open step is due today
  or overdue (checked hourly). The platform shows them in the inbox (Home) of
  people who may open the CRM, never to the person who made the change. Events
  wait in `event_outbox` until the platform accepts them; saving never depends
  on it. The app needs the grant `execute` on `platform.emit_event`.

## References (0.5.0, ADR 0023)

`@{app:type:id}` in a note or next step links to an item of another app,
`@{human:<email>}` mentions someone; the timeline and the next steps show
chips. Notes and next steps with references are reported to
`platform.set_refs` through `refs_outbox`. Deals, companies and contacts list
what points to them from other apps, and a deal offers "Create task" in Tasks.
Other apps link to `crm:company:<id>`, `crm:contact:<id>` and `crm:deal:<id>`
(resolver `crm.resolve`).

## Pages

| Path                                                      | What                                                                                                           |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `/`                                                       | Overview: open deals, value, won, overdue and upcoming next steps, totals per stage, recent activity           |
| `/pipeline`                                               | Board: one column per stage, drag a card or pick its stage; won and lost ask for the reason; Undo in the toast |
| `/deals`, `/deals/<id>`, `/deals/<id>/edit`, `/deals/new` | Deals with search and filters (`?stage=` also takes `open`, `closed`), detail with timeline and next steps     |
| `/companies`, `/companies/<id>`, `/companies/new`         | Companies; detail brings contacts, deals, next steps and timeline together                                     |
| `/contacts`, `/contacts/<id>`, `/contacts/new`            | Contacts (`?q=`, `?company=`); detail with deals, next steps and timeline                                      |
| `/next-steps/new`, `/activities/new`                      | Plan a next step, log an activity (`?deal=`, `?company=`, `?contact=` prefill)                                 |
| `/deals/stage`                                            | Change a stage without the board (form)                                                                        |

## Layout

- `migrations/0001_crm.sql` — tables, checks, indexes
- `migrations/0002_english_values.sql` — English values: column `industry`,
  stages and activity kinds
- `migrations/0003_deal_close.sql` — `closed_at` and `close_reason` on deals,
  kept consistent with the stage by a trigger
- `migrations/0004_next_steps.sql` — table `next_steps`
- `seeds/0001_beispieldaten.sql`, `seeds/0002_next_steps.sql` — made-up
  companies, contacts, deals, activities and next steps, one of them overdue
  (local only)
- `src/instrumentation.ts` — applies the migrations on start
- `src/lib/schemas.ts` — arguments of every tool (zod, strict)
- `src/lib/stages.ts` — rules of a stage change as a pure function
- `src/lib/crm.ts` — data access
- `src/lib/pipeline.ts` — pipeline calculation as a pure function
- `src/lib/tools.ts` — the tool table, used by the route and the UI
- `src/app/api/tools/[tool]/route.ts` — `createToolRoute`
- `src/app/actions.ts` — server actions of the UI, they call the tools
- `src/components/StageMover.tsx` — stage change with reason dialog and Undo
- `src/components/PipelineBoard.tsx`, `NextStepList.tsx`, `Timeline.tsx` —
  board, next steps with Done/Undo, timeline
- `src/app/layout.tsx` — the shared platform sidebar (`loadShell` from
  `@openapps/sdk/next`, `NextPlatformShell` from `@openapps/ui/next`); the
  app only adds its sections in `SECTIONS`

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
