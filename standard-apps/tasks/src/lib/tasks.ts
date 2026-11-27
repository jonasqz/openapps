import { ToolInputError, ToolNotFoundError } from '@openapps/sdk';
import { query, withTransaction, type Query } from './db';
import type { TaskCreateArgs, TaskListArgs } from './schemas';
import {
  planChange,
  STATUS_LABELS,
  type ColumnChanges,
  type EventKind,
  type Priority,
  type Status,
  type TaskPatch,
  type TaskState,
} from './workflow';

/**
 * Lesen und Schreiben der Aufgaben. Jede Aenderung laeuft in einer
 * Transaktion zusammen mit ihrem Verlaufseintrag. Kein Rechte-Code: Wer
 * dieses Modul erreicht, hat das Gateway und die Freigabe schon hinter sich.
 */

export interface Task {
  id: string;
  title: string;
  description: string;
  status: Status;
  priority: Priority;
  /** E-Mail-Adresse oder null (noch niemandem zugewiesen). */
  assignee: string | null;
  /** JJJJ-MM-TT oder null. */
  dueDate: string | null;
  /** Faellig vor heute und nicht Done. Heute nach der Uhr der Datenbank. */
  overdue: boolean;
  projectId: string | null;
  projectName: string | null;
  /** Abgeleitet aus status = done; bleibt fuer Aufrufer der Version 0.1. */
  completed: boolean;
  completedAt: string | null;
  completedBy: string | null;
  commentCount: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskComment {
  id: string;
  body: string;
  author: string;
  createdAt: string;
}

export interface TaskEvent {
  id: string;
  kind: EventKind;
  from: string | null;
  to: string | null;
  actor: string;
  createdAt: string;
}

interface TaskRow extends Record<string, unknown> {
  id: string;
  title: string;
  description: string;
  status: Status;
  priority: Priority;
  assignee: string | null;
  due_date: string | null;
  overdue: boolean;
  project_id: string | null;
  project_name: string | null;
  completed_at: Date | null;
  completed_by: string | null;
  comment_count: number;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

/** Datum als Text aus der DB holen, damit keine Zeitzone es verschiebt. */
const SELECT_TASK = `
  select t.id, t.title, t.description, t.status, t.priority, t.assignee,
         to_char(t.due_date, 'YYYY-MM-DD') as due_date,
         coalesce(t.status <> 'done' and t.due_date < current_date, false) as overdue,
         t.project_id, p.name as project_name,
         t.completed_at, t.completed_by,
         (select count(*) from task_comments c where c.task_id = t.id)::int as comment_count,
         t.created_by, t.created_at, t.updated_at
    from tasks t
    left join projects p on p.id = t.project_id`;

/**
 * In Arbeit zuerst, dann To do, Done zuletzt. Offene nach Faelligkeit (ohne
 * Datum zuletzt), erledigte nach Abschluss (neueste zuerst), dann Prioritaet.
 */
const ORDER_TASKS = `
  order by case t.status when 'in_progress' then 0 when 'todo' then 1 else 2 end,
           case when t.status = 'done' then null else t.due_date end nulls last,
           t.completed_at desc nulls last,
           case t.priority when 'high' then 0 when 'medium' then 1 else 2 end,
           t.created_at desc`;

const toTask = (row: TaskRow): Task => ({
  id: row.id,
  title: row.title,
  description: row.description,
  status: row.status,
  priority: row.priority,
  assignee: row.assignee,
  dueDate: row.due_date,
  overdue: row.overdue,
  projectId: row.project_id,
  projectName: row.project_name,
  completed: row.status === 'done',
  completedAt: row.completed_at?.toISOString() ?? null,
  completedBy: row.completed_by,
  commentCount: row.comment_count,
  createdBy: row.created_by,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

/** `%` und `_` sind in ILIKE Platzhalter; eine Suche nach "50%" meint das Zeichen. */
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/**
 * Aufgaben nach Filter. `me` ist die E-Mail der aufrufenden Person und nur
 * fuer `mine` noetig.
 */
export async function listTasks(args: TaskListArgs = {}, me: string | null = null): Promise<Task[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  const param = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  if (args.status !== undefined) where.push(`t.status = ${param(args.status)}`);
  if (args.completed === true) where.push(`t.status = 'done'`);
  if (args.completed === false) where.push(`t.status <> 'done'`);
  if (args.mine === true) {
    if (me === null || me.trim() === '') {
      throw new ToolInputError('mine needs a caller with an email address. Pass assignee instead.');
    }
    where.push(`lower(t.assignee) = lower(${param(me)})`);
  }
  if (args.assignee !== undefined) where.push(`lower(t.assignee) = lower(${param(args.assignee)})`);
  if (args.unassigned === true) where.push('t.assignee is null');
  if (args.overdue === true) where.push(`t.status <> 'done' and t.due_date < current_date`);
  if (args.overdue === false) where.push(`not coalesce(t.status <> 'done' and t.due_date < current_date, false)`);
  if (args.projectId !== undefined) where.push(`t.project_id = ${param(args.projectId)}`);
  if (args.query !== undefined) {
    const pattern = param(likePattern(args.query));
    where.push(`(t.title ilike ${pattern} or t.description ilike ${pattern})`);
  }
  const limit = param(args.limit ?? 50);

  const rows = await query<TaskRow>(
    `${SELECT_TASK}
     ${where.length > 0 ? `where ${where.join(' and ')}` : ''}
     ${ORDER_TASKS}
     limit ${limit}`,
    params,
  );
  return rows.map(toTask);
}

async function fetchTask(q: Query, id: string): Promise<Task> {
  const rows = await q<TaskRow>(`${SELECT_TASK} where t.id = $1`, [id]);
  const row = rows[0];
  if (row === undefined) throw notFound(id);
  return toTask(row);
}

function notFound(id: string): ToolNotFoundError {
  return new ToolNotFoundError(`No task with id ${id}. The id comes from tasks.list.`);
}

export interface TaskDetail {
  task: Task;
  comments: TaskComment[];
  /** Aeltester Eintrag zuerst. */
  history: TaskEvent[];
}

export async function getTask(id: string): Promise<TaskDetail> {
  const task = await fetchTask(query, id);
  const [comments, events] = await Promise.all([
    query<{ id: string; body: string; author: string; created_at: Date }>(
      `select id, body, author, created_at from task_comments
        where task_id = $1 order by created_at, id`,
      [id],
    ),
    query<{
      id: string;
      kind: EventKind;
      from_value: string | null;
      to_value: string | null;
      actor: string;
      created_at: Date;
    }>(
      `select id, kind, from_value, to_value, actor, created_at from task_events
        where task_id = $1 order by created_at, id`,
      [id],
    ),
  ]);
  return {
    task,
    comments: comments.map((row) => ({
      id: row.id,
      body: row.body,
      author: row.author,
      createdAt: row.created_at.toISOString(),
    })),
    history: events.map((row) => ({
      id: row.id,
      kind: row.kind,
      from: row.from_value,
      to: row.to_value,
      actor: row.actor,
      createdAt: row.created_at.toISOString(),
    })),
  };
}

/** Name des Projekts oder ein Fehler, den ein Agent versteht. */
async function projectName(q: Query, projectId: string): Promise<string> {
  const rows = await q<{ name: string }>('select name from projects where id = $1', [projectId]);
  const name = rows[0]?.name;
  if (name === undefined) {
    const message = `No project with id ${projectId}. The id comes from projects.list.`;
    throw new ToolInputError(message, [{ path: ['projectId'], message }]);
  }
  return name;
}

async function insertEvent(
  q: Query,
  taskId: string,
  event: { kind: EventKind; from: string | null; to: string | null },
  actor: string,
): Promise<void> {
  await q(
    `insert into task_events (task_id, kind, from_value, to_value, actor) values ($1, $2, $3, $4, $5)`,
    [taskId, event.kind, event.from, event.to, actor],
  );
}

export async function createTask(input: TaskCreateArgs, actor: string): Promise<Task> {
  return withTransaction(async (q) => {
    if (input.projectId !== undefined) await projectName(q, input.projectId);
    const status = input.status ?? 'todo';
    const rows = await q<{ id: string }>(
      `insert into tasks (title, description, status, priority, assignee, due_date, project_id,
                          completed_at, completed_by, created_by)
       values ($1, $2, $3, $4, $5, $6, $7,
               case when $3 = 'done' then now() end,
               case when $3 = 'done' then $8 end,
               $8)
       returning id`,
      [
        input.title,
        input.description ?? '',
        status,
        input.priority ?? 'medium',
        input.assignee ?? null,
        input.dueDate ?? null,
        input.projectId ?? null,
        actor,
      ],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('insert returned no row');
    await insertEvent(q, id, { kind: 'created', from: null, to: null }, actor);
    return fetchTask(q, id);
  });
}

export interface UpdateResult {
  task: Task;
  changed: boolean;
  /** Status vor dem Aufruf — damit laesst sich ein Abschluss rueckgaengig machen. */
  previousStatus: Status;
}

/** Spalten, die ein Update setzen darf. Nur diese Namen landen im SQL. */
const UPDATABLE: readonly (keyof ColumnChanges)[] = [
  'title',
  'description',
  'status',
  'priority',
  'assignee',
  'due_date',
  'project_id',
];

/**
 * Aendert eine Aufgabe. Liest sie mit `for update`, damit zwei gleichzeitige
 * Aenderungen nacheinander laufen und jede den Stand der anderen sieht.
 */
export async function updateTask(
  id: string,
  patch: Omit<TaskPatch, 'projectName'>,
  actor: string,
  expectedStatus?: Status,
): Promise<UpdateResult> {
  return withTransaction(async (q) => {
    const rows = await q<{
      title: string;
      description: string;
      status: Status;
      priority: Priority;
      assignee: string | null;
      due_date: string | null;
      project_id: string | null;
      project_name: string | null;
    }>(
      `select t.title, t.description, t.status, t.priority, t.assignee,
              to_char(t.due_date, 'YYYY-MM-DD') as due_date, t.project_id, p.name as project_name
         from tasks t left join projects p on p.id = t.project_id
        where t.id = $1
          for update of t`,
      [id],
    );
    const row = rows[0];
    if (row === undefined) throw notFound(id);
    const current: TaskState = {
      title: row.title,
      description: row.description,
      status: row.status,
      priority: row.priority,
      assignee: row.assignee,
      dueDate: row.due_date,
      projectId: row.project_id,
      projectName: row.project_name,
    };

    if (expectedStatus !== undefined && current.status !== expectedStatus) {
      const message =
        `The task is ${STATUS_LABELS[current.status]} now, not ${STATUS_LABELS[expectedStatus]}. ` +
        'Someone changed it in the meantime; nothing was changed. Load it again with tasks.get.';
      throw new ToolInputError(message, [{ path: ['expectedStatus'], message }]);
    }

    const full: TaskPatch = { ...patch };
    if (patch.projectId !== undefined && patch.projectId !== null) {
      full.projectName = await projectName(q, patch.projectId);
    }

    const plan = planChange(current, full);
    const keys = UPDATABLE.filter((key) => plan.columns[key] !== undefined);
    if (keys.length === 0) {
      return { task: await fetchTask(q, id), changed: false, previousStatus: current.status };
    }

    const params: unknown[] = [id];
    const sets = keys.map((key) => {
      params.push(plan.columns[key]);
      return `${key} = $${params.length}`;
    });
    if (plan.completion === 'complete') {
      params.push(actor);
      sets.push(`completed_at = now()`, `completed_by = $${params.length}`);
    } else if (plan.completion === 'reopen') {
      sets.push('completed_at = null', 'completed_by = null');
    }
    sets.push('updated_at = now()');
    await q(`update tasks set ${sets.join(', ')} where id = $1`, params);

    for (const event of plan.events) await insertEvent(q, id, event, actor);
    return { task: await fetchTask(q, id), changed: true, previousStatus: current.status };
  });
}

export async function addComment(
  taskId: string,
  body: string,
  author: string,
): Promise<TaskComment> {
  const rows = await query<{ id: string; body: string; author: string; created_at: Date }>(
    `insert into task_comments (task_id, body, author)
     select id, $2, $3 from tasks where id = $1
     returning id, body, author, created_at`,
    [taskId, body, author],
  );
  const row = rows[0];
  if (row === undefined) throw notFound(taskId);
  return { id: row.id, body: row.body, author: row.author, createdAt: row.created_at.toISOString() };
}

/** Alle bisher zugewiesenen Adressen, fuer den Filter der Liste. */
export async function listAssignees(): Promise<string[]> {
  const rows = await query<{ assignee: string }>(
    `select distinct lower(assignee) as assignee from tasks
      where assignee is not null order by 1 limit 200`,
  );
  return rows.map((row) => row.assignee);
}
