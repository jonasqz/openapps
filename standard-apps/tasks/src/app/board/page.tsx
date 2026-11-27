import { Badge, Card, CardBody, CardHeader, EmptyState, ErrorState, PageHeader } from '@openapps/ui';
import { FilterBar } from '@/components/FilterBar';
import { ButtonLink, TextLink } from '@/components/links';
import { MoveButtons } from '@/components/StatusButtons';
import { parseFilters, toListArgs, type SearchParams } from '@/lib/filters';
import { formatDate } from '@/lib/format';
import { currentUser } from '@/lib/me';
import { listProjects, type Project } from '@/lib/projects';
import { listAssignees, listTasks, type Task } from '@/lib/tasks';
import { PRIORITY_LABELS, STATUS_LABELS, STATUSES, type Status } from '@/lib/workflow';

export const dynamic = 'force-dynamic';

/** Offene Aufgaben auf dem Board; mehr passt ohnehin nicht sinnvoll auf eine Seite. */
const OPEN_LIMIT = 200;
/** Done zeigt nur die zuletzt erledigten, sonst waechst die Spalte ewig. */
const DONE_LIMIT = 20;

const EMPTY: Record<Status, { title: string; description: string }> = {
  todo: { title: 'Nothing to do', description: 'New tasks start here.' },
  in_progress: { title: 'Nothing in progress', description: 'Start a task to move it here.' },
  done: { title: 'Nothing done yet', description: 'Completed tasks show up here.' },
};

/**
 * Das Board: eine Spalte pro Status. Verschieben ruft `tasks.update` bzw.
 * `tasks.complete` (mit Undo). Filter wie in der Liste, ohne Status.
 */
export default async function BoardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const filters = { ...parseFilters(await searchParams), status: '' as const };
  const user = await currentUser();
  const effective = filters.assignee === 'me' && user === null ? { ...filters, assignee: '' } : filters;
  const me = user?.email ?? null;

  let open: Task[] = [];
  let done: Task[] = [];
  let projects: Project[] = [];
  let assignees: string[] = [];
  let failed = false;
  try {
    [open, done, projects, assignees] = await Promise.all([
      listTasks({ ...toListArgs(effective, OPEN_LIMIT), completed: false }, me),
      listTasks({ ...toListArgs(effective, DONE_LIMIT), status: 'done' }, me),
      listProjects(),
      listAssignees(),
    ]);
  } catch (error) {
    console.error('[tasks] loading board:', error);
    failed = true;
  }

  const columns: Record<Status, Task[]> = {
    todo: open.filter((task) => task.status === 'todo'),
    in_progress: open.filter((task) => task.status === 'in_progress'),
    done,
  };

  return (
    <>
      <PageHeader
        eyebrow="Tasks"
        title="Board"
        description={`Every task by status. Done shows the last ${DONE_LIMIT} completed.`}
        actions={<ButtonLink href="/new">New task</ButtonLink>}
      />
      <FilterBar values={filters} assignees={assignees} projects={projects} showStatus={false} />
      {failed ? (
        <ErrorState title="The board could not be loaded" description="The database did not respond. Reload the page." />
      ) : (
        <div className="grid min-w-0 gap-4 lg:grid-cols-3">
          {STATUSES.map((status) => (
            <Card key={status} aria-label={STATUS_LABELS[status]}>
              <CardHeader
                title={STATUS_LABELS[status]}
                actions={<span className="font-mono text-2xs tabular-nums text-fg-muted">{columns[status].length}</span>}
              />
              <CardBody className="flex flex-col gap-3">
                {columns[status].length === 0 ? (
                  <EmptyState title={EMPTY[status].title} description={EMPTY[status].description} />
                ) : (
                  <ul className="flex min-w-0 flex-col gap-3">
                    {columns[status].map((task) => (
                      <li
                        key={task.id}
                        className={
                          task.overdue
                            ? 'flex min-w-0 flex-col gap-2 rounded-md border border-danger p-3'
                            : 'flex min-w-0 flex-col gap-2 rounded-md border border-border p-3'
                        }
                      >
                        <TextLink href={`/task/${task.id}`} className="[overflow-wrap:anywhere]">
                          {task.title}
                        </TextLink>
                        <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-fg-muted">
                          {task.overdue ? <Badge tone="danger">Overdue</Badge> : null}
                          {task.priority === 'high' ? <Badge tone="warning">{PRIORITY_LABELS.high}</Badge> : null}
                          <span className="truncate">{task.assignee ?? 'Unassigned'}</span>
                          {task.dueDate === null ? null : <span>Due {formatDate(task.dueDate)}</span>}
                          {task.projectName === null ? null : <span className="truncate">{task.projectName}</span>}
                        </div>
                        <MoveButtons id={task.id} title={task.title} status={task.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
