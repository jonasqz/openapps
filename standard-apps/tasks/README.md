# Tasks

Team tasks on the openapps platform: title, assignee, due date, completed
yes/no. People use the list under `/tasks`, agents use the same functions as
tools.

## Tools

| Tool             | Verb  | What it does                                         |
| ---------------- | ----- | ---------------------------------------------------- |
| `tasks.list`     | read  | Tasks, open ones first, filter by completed/assignee |
| `tasks.create`   | write | Create a task (title, assignee, dueDate)             |
| `tasks.complete` | write | Mark a task as completed (id)                        |

In the MCP they are called `tasks__tasks__list` and so on; arguments go into
the `args` field. The UI calls the same handlers (`src/app/actions.ts`).

## Pages

| Path   | What it shows              |
| ------ | -------------------------- |
| `/`    | All tasks, open ones first |
| `/new` | Form to create a task      |

## Structure

- `app.json`, `openapi.yaml`, `src/lib/tools.ts` name the same tools;
  `src/lib/tools.test.ts` keeps them in sync.
- `migrations/0001_tasks.sql` — the `tasks` table.
- `seeds/` — sample data, local only.

## Local

```bash
pnpm --filter ./standard-apps/tasks typecheck
pnpm --filter ./standard-apps/tasks test
./infra/lokal/apps-ausrollen.sh tasks
```
