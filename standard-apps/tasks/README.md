# Tasks

Team tasks on the openapps platform: status (To do, In progress, Done),
assignee, due date, priority, description, projects, comments and a history
of every change. People use the pages under `/tasks`, agents use the same
functions as tools.

## Tools

| Tool              | Verb  | What it does                                                        |
| ----------------- | ----- | ------------------------------------------------------------------- |
| `tasks.list`      | read  | Tasks with filters: mine, assignee, unassigned, status, overdue, project, text |
| `tasks.get`       | read  | One task with its comments and history                              |
| `tasks.create`    | write | Create a task (title; optional description, assignee, due date, priority, status, project) |
| `tasks.update`    | write | Change any field, including status; `expectedStatus` guards undo    |
| `tasks.assign`    | write | Assign by email, or unassign with `null`                            |
| `tasks.complete`  | write | Set to done; returns `previousStatus` for undo                      |
| `tasks.comment`   | write | Add a comment                                                       |
| `tasks.create_from_ref` | write | Create a task from a wiki page or deal (`sourceRef`, `excerpt`); links back as `derived` (ADR 0023) |
| `tasks.resolve`   | read  | Title, path and status of tasks and projects for chips in other apps (ADR 0023) |
| `projects.list`   | read  | Projects with open, overdue and done counts                         |
| `projects.create` | write | Create a project (unique name)                                      |
| `search`          | read  | Tasks and projects at once (`query`, `limit`); the tool of Tasks for the search across all apps (ADR 0021) |

In the MCP they are called `tasks__tasks__list`, `tasks__projects__list` and
so on; arguments go into the `args` field. The UI calls the same handlers
(`src/app/actions.ts`), so every button has its tool.

Typical agent calls:

- My open tasks: `tasks.list` with `{ "mine": true, "completed": false }`
- Overdue across the team: `tasks.list` with `{ "overdue": true }`
- Hand a task over: `tasks.assign` with `{ "id": "…", "assignee": "sam@example.com" }`
- Undo a completion: `tasks.update` with
  `{ "id": "…", "status": "<previousStatus>", "expectedStatus": "done" }`

## People and assignment

The platform gives an app no directory of people, so a task is assigned to an
**email address**. "My tasks" and `mine: true` match the email that `getUser`
returns for the caller (for an agent, its `…@agents.invalid` address).
The app sends no mail. It reports `task.assigned`, `task.commented` and
`task.status_changed` to the platform (since 0.4.0, ADR 0022); the platform
shows them in the inbox (Home) of the assignee and the creator, if they may
open Tasks, never to the person who made the change. Events wait in
`event_outbox` until the platform accepts them, so saving never depends on it.

In the history and as author, people appear with their email and agents as
`agent:<name>`.

## References (0.5.0, ADR 0023)

`@{app:type:id}` in a description or comment links to an item of another app
(`@{wiki:page:<id>}`, `@{crm:deal:<id>}`), `@{human:<email>}` mentions
someone. The task page shows them as chips and lists what points to the task
from other apps; both load in the browser through the platform with the
viewer's rights. Tasks reports the full set of a task's references to
`platform.set_refs` through `refs_outbox`. Other apps link to tasks and
projects as `tasks:task:<id>` and `tasks:project:<id>` (resolver
`tasks.resolve`). "Create task" on a wiki page or deal opens
`/new?ref=…&excerpt=…`; the person confirms here, as themselves, and the task
stores its source in `source_ref`.

## Status

Any status can move to any other. Moving to Done records who completed the
task and when; moving away from Done clears both. Setting the same status
again changes nothing and leaves no history entry. A task is **overdue** when
its due date is before today (database clock) and it is not done.

## Pages

| Path              | What it shows                                                 |
| ----------------- | ------------------------------------------------------------- |
| `/`               | My tasks: open tasks assigned to me, with counts              |
| `/board`          | Board with a column per status; Done shows the last 20         |
| `/all`            | All tasks with search and filters (status, assignee, project, overdue) |
| `/task/<id>`      | One task: details, status, assignment, comments, history       |
| `/task/<id>/edit` | Edit form                                                     |
| `/new`            | New task (`?project=<id>` preselects a project)                |
| `/projects`       | Projects with counts                                          |
| `/projects/new`   | New project                                                   |

Completing a task shows a message with **Undo**. Undo only resets the status
if the task is still done, so it never overwrites someone else's change.

## Structure

- `app.json`, `openapi.yaml`, `src/lib/tools.ts` name the same tools;
  `src/lib/tools.test.ts` keeps them in sync and checks input validation.
- `src/lib/workflow.ts` holds the status rules and what lands in the
  history, without a database (`workflow.test.ts`).
- `src/lib/tasks.ts`, `src/lib/projects.ts` read and write. Every change and
  its history entry run in one transaction.
- `migrations/` — `0001` tasks, `0002` projects, `0003` status, priority,
  description and project on tasks, `0004` comments, `0005` history.
  `status` is the source; the old `completed` column is kept in sync by a
  trigger.
- `seeds/` — sample data, local only. Assigns tasks to `viewer@local.test`,
  the person the local viewing proxy signs as.

## Local

```bash
pnpm --filter ./standard-apps/tasks typecheck
pnpm --filter ./standard-apps/tasks lint
pnpm --filter ./standard-apps/tasks test
./infra/lokal/apps-ausrollen.sh tasks
```

`src/lib/tasks.db.test.ts` runs against a real Postgres when
`TASKS_TEST_DATABASE_URL` and `TASKS_TEST_DATABASE_SCHEMA` point to an empty
schema owned by a role without SUPERUSER and BYPASSRLS; otherwise it is
skipped.
