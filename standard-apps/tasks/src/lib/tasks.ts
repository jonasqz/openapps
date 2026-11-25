import { ToolNotFoundError } from '@openapps/sdk';
import { query } from './db';
import type { TaskCreateArgs, TaskListArgs } from './schemas';

export interface Task {
  id: string;
  title: string;
  assignee: string;
  /** JJJJ-MM-TT oder null. */
  dueDate: string | null;
  completed: boolean;
  completedAt: string | null;
  completedBy: string | null;
  createdBy: string;
  createdAt: string;
}

interface TaskRow extends Record<string, unknown> {
  id: string;
  title: string;
  assignee: string;
  due_date: string | null;
  completed: boolean;
  completed_at: Date | null;
  completed_by: string | null;
  created_by: string;
  created_at: Date;
}

/** Datum als Text aus der DB holen, damit keine Zeitzone es verschiebt. */
const COLUMNS = `id, title, assignee, to_char(due_date, 'YYYY-MM-DD') as due_date,
  completed, completed_at, completed_by, created_by, created_at`;

const toTask = (row: TaskRow): Task => ({
  id: row.id,
  title: row.title,
  assignee: row.assignee,
  dueDate: row.due_date,
  completed: row.completed,
  completedAt: row.completed_at?.toISOString() ?? null,
  completedBy: row.completed_by,
  createdBy: row.created_by,
  createdAt: row.created_at.toISOString(),
});

/** Offene zuerst, dann nach Fälligkeit (ohne Datum zuletzt), dann neueste. */
export async function listTasks(args: TaskListArgs = {}): Promise<Task[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (args.completed !== undefined) {
    params.push(args.completed);
    where.push(`completed = $${params.length}`);
  }
  if (args.assignee !== undefined) {
    params.push(args.assignee);
    where.push(`lower(assignee) = lower($${params.length})`);
  }
  params.push(args.limit ?? 50);
  const rows = await query<TaskRow>(
    `select ${COLUMNS} from tasks
     ${where.length > 0 ? `where ${where.join(' and ')}` : ''}
     order by completed, due_date nulls last, created_at desc
     limit $${params.length}`,
    params,
  );
  return rows.map(toTask);
}

export async function createTask(input: TaskCreateArgs, createdBy: string): Promise<Task> {
  const rows = await query<TaskRow>(
    `insert into tasks (title, assignee, due_date, created_by)
     values ($1, $2, $3, $4) returning ${COLUMNS}`,
    [input.title, input.assignee, input.dueDate ?? null, createdBy],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('insert returned no row');
  return toTask(row);
}

/** Setzt completed. Ist die Aufgabe schon erledigt, ändert sich nichts. */
export async function completeTask(
  id: string,
  by: string,
): Promise<{ task: Task; changed: boolean }> {
  const updated = await query<TaskRow>(
    `update tasks set completed = true, completed_at = now(), completed_by = $2
     where id = $1 and not completed returning ${COLUMNS}`,
    [id, by],
  );
  if (updated[0] !== undefined) return { task: toTask(updated[0]), changed: true };

  const existing = await query<TaskRow>(`select ${COLUMNS} from tasks where id = $1`, [id]);
  if (existing[0] === undefined) {
    throw new ToolNotFoundError(`No task with id ${id}. The id comes from tasks.list.`);
  }
  return { task: toTask(existing[0]), changed: false };
}
