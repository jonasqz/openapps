import { ErrorState, PageHeader, Stat, StatGroup } from '@openapps/ui';
import { ButtonLink } from '@/components/links';
import { TaskTable } from '@/components/TaskTable';
import { currentUser } from '@/lib/me';
import { toRowData } from '@/lib/rows';
import { listTasks, type Task } from '@/lib/tasks';

/**
 * Immer zur Laufzeit rendern, sonst rendert Next schon beim Build ohne
 * Datenbank und liefert für immer den Fehlerzustand.
 */
export const dynamic = 'force-dynamic';

/**
 * "My tasks": was der angemeldeten Person zugewiesen ist. Dieselbe Abfrage
 * liefert das Tool `tasks.list` mit `{ mine: true, completed: false }`.
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export default async function MyTasksPage() {
  const user = await currentUser();
  if (user === null) {
    return (
      <>
        <PageHeader eyebrow="Tasks" title="My tasks" />
        <ErrorState
          title="You are not signed in"
          description="This page shows the tasks assigned to you, and the request did not come through the platform sign-in. Reload the page."
        />
      </>
    );
  }

  let tasks: Task[] = [];
  let failed = false;
  try {
    tasks = await listTasks({ mine: true, limit: 200 }, user.email);
  } catch (error) {
    console.error('[tasks] loading my tasks:', error);
    failed = true;
  }

  const open = tasks.filter((task) => task.status !== 'done');
  const inProgress = open.filter((task) => task.status === 'in_progress').length;
  const overdue = open.filter((task) => task.overdue).length;
  const weekAgo = Date.now() - WEEK_MS;
  const doneThisWeek = tasks.filter(
    (task) => task.completedAt !== null && new Date(task.completedAt).getTime() >= weekAgo,
  ).length;

  return (
    <>
      <PageHeader
        eyebrow="Tasks"
        title="My tasks"
        description={`Open tasks assigned to ${user.email}. In progress first, then by due date.`}
        actions={<ButtonLink href="/new">New task</ButtonLink>}
      />
      {failed ? null : (
        <StatGroup>
          <Stat label="Open" value={open.length} />
          <Stat label="In progress" value={inProgress} />
          <Stat
            label="Overdue"
            value={overdue}
            tone={overdue > 0 ? 'danger' : 'neutral'}
            hint={overdue > 0 ? 'Past the due date' : 'Nothing overdue'}
          />
          <Stat label="Done this week" value={doneThisWeek} tone="success" />
        </StatGroup>
      )}
      <TaskTable
        caption="My open tasks"
        hideAssignee
        tasks={failed ? [] : open.map(toRowData)}
        empty={{
          title: 'Nothing assigned to you',
          description: 'Tasks assigned to your email address show up here. Pick one from the board or create one.',
          action: <ButtonLink href="/board" variant="secondary">Open the board</ButtonLink>,
        }}
        error={
          failed
            ? {
                title: 'Your tasks could not be loaded',
                description: 'The database did not respond. Reload the page.',
              }
            : undefined
        }
      />
    </>
  );
}
