import type { ReactNode } from 'react';
import { Badge, Table } from '@openapps/ui';
import { CompleteButton } from '@/components/CompleteButton';
import { ButtonLink } from '@/components/links';
import { listTasks, type Task } from '@/lib/tasks';

/**
 * Immer zur Laufzeit rendern, sonst rendert Next schon beim Build ohne
 * Datenbank und liefert für immer den Fehlerzustand.
 */
export const dynamic = 'force-dynamic';

/**
 * Die Aufgabenliste. Dieselbe Liste liefert das Tool `tasks.list`.
 * Server-Seite: Spalten nennen nur `field`, die Zellen stehen fertig in der
 * Zeile.
 */
interface TaskRow {
  id: string;
  title: string;
  assignee: string;
  due: string;
  status: ReactNode;
  action: ReactNode;
}

/** JJJJ-MM-TT als Datum in en-GB. UTC, damit keine Zeitzone den Tag verschiebt. */
function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC' });
}

const toRow = (task: Task, today: string): TaskRow => ({
  id: task.id,
  title: task.title,
  assignee: task.assignee,
  due: task.dueDate === null ? '–' : formatDate(task.dueDate),
  status: task.completed ? (
    <Badge tone="success">Completed</Badge>
  ) : task.dueDate !== null && task.dueDate < today ? (
    <Badge tone="danger">Overdue</Badge>
  ) : (
    <Badge tone="neutral">Open</Badge>
  ),
  action: task.completed ? null : <CompleteButton id={task.id} title={task.title} />,
});

export default async function TasksPage() {
  let tasks: Task[] = [];
  let failed = false;
  try {
    tasks = await listTasks({ limit: 200 });
  } catch (error) {
    console.error('[tasks] loading list:', error);
    failed = true;
  }
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-fg">Tasks</h1>
          <p className="mt-1 text-sm text-fg-muted">Open tasks first, then by due date.</p>
        </div>
        <ButtonLink href="/new">New task</ButtonLink>
      </header>
      <Table<TaskRow>
        caption="Tasks"
        rows={failed ? [] : tasks.map((task) => toRow(task, today))}
        columns={[
          { field: 'title', header: 'Title' },
          { field: 'assignee', header: 'Assignee' },
          { field: 'due', header: 'Due', hideBelow: 'sm' },
          { field: 'status', header: 'Status' },
          { field: 'action', header: 'Action' },
        ]}
        empty={{
          title: 'No tasks yet',
          description: 'Create the first task and it will show up here.',
          action: <ButtonLink href="/new">New task</ButtonLink>,
        }}
        error={
          failed
            ? {
                title: 'Tasks could not be loaded',
                description: 'The database did not respond. Reload the page.',
              }
            : undefined
        }
      />
    </>
  );
}
