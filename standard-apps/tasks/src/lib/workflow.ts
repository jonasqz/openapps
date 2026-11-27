import type { PlatformUser } from '@openapps/sdk';

/**
 * Der Ablauf einer Aufgabe, ohne Datenbank: Status, Prioritaet, wer als
 * Handelnder gilt und was eine Aenderung im Verlauf hinterlaesst. Alles hier
 * ist rein und deshalb ohne Postgres testbar (workflow.test.ts).
 */

export const STATUSES = ['todo', 'in_progress', 'done'] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
};

export const PRIORITIES = ['low', 'medium', 'high'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

export const EVENT_KINDS = [
  'created',
  'status',
  'assignee',
  'due_date',
  'priority',
  'title',
  'description',
  'project',
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export function isStatus(value: unknown): value is Status {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}

export function isPriority(value: unknown): value is Priority {
  return typeof value === 'string' && (PRIORITIES as readonly string[]).includes(value);
}

/**
 * Wer im Verlauf, als Ersteller und als Kommentator steht. Ein Agent mit
 * seiner Kennung `agent:<name>` (so verlangt es die Plattform), ein Mensch
 * mit seiner E-Mail-Adresse — die Nutzer-Id des Gateways ist fuer Menschen
 * nicht lesbar, und die Zuweisung laeuft ohnehin ueber die E-Mail.
 */
export function actorOf(user: Pick<PlatformUser, 'id' | 'email'>): string {
  if (user.id.startsWith('agent:')) return user.id;
  const email = user.email.trim().toLowerCase();
  return email === '' ? user.id : email;
}

/** Der Teil einer Aufgabe, den eine Aenderung beruehren kann. */
export interface TaskState {
  title: string;
  description: string;
  status: Status;
  priority: Priority;
  assignee: string | null;
  dueDate: string | null;
  projectId: string | null;
  /** Name des Projekts, nur fuer den Verlauf. */
  projectName: string | null;
}

/**
 * Eine gewuenschte Aenderung. Fehlt ein Feld, bleibt es; `null` leert es
 * (nur bei Feldern, die leer sein duerfen).
 */
export interface TaskPatch {
  title?: string | undefined;
  description?: string | undefined;
  status?: Status | undefined;
  priority?: Priority | undefined;
  assignee?: string | null | undefined;
  dueDate?: string | null | undefined;
  projectId?: string | null | undefined;
  /** Name des neuen Projekts, wenn `projectId` gesetzt ist. */
  projectName?: string | null | undefined;
}

export interface EventDraft {
  kind: EventKind;
  from: string | null;
  to: string | null;
}

/** Spalten, die ein Update setzt, mit dem Namen in der Datenbank. */
export interface ColumnChanges {
  title?: string;
  description?: string;
  status?: Status;
  priority?: Priority;
  assignee?: string | null;
  due_date?: string | null;
  project_id?: string | null;
}

export interface ChangePlan {
  /** Leer heisst: nichts zu tun, kein Update, kein Verlauf. */
  columns: ColumnChanges;
  events: EventDraft[];
  /**
   * Was mit dem Abschluss passiert: `complete` setzt completed_at und
   * completed_by, `reopen` leert beide. Ein Wechsel zwischen To do und In
   * progress beruehrt sie nicht.
   */
  completion: 'complete' | 'reopen' | null;
}

/**
 * Vergleicht die Aufgabe mit der gewuenschten Aenderung und sagt, was zu
 * schreiben ist. Gleiche Werte sind keine Aenderung: Das haelt den Verlauf
 * frei von Rauschen und macht "nochmals erledigen" zu einem No-op.
 *
 * Jeder Statuswechsel ist erlaubt, auch Done -> To do (wieder oeffnen) und
 * To do -> Done ohne Umweg. Ein Team soll nicht an einem Ablauf scheitern,
 * den die App vorschreibt.
 */
export function planChange(current: TaskState, patch: TaskPatch): ChangePlan {
  const columns: ColumnChanges = {};
  const events: EventDraft[] = [];
  let completion: ChangePlan['completion'] = null;

  if (patch.title !== undefined && patch.title !== current.title) {
    columns.title = patch.title;
    events.push({ kind: 'title', from: current.title, to: patch.title });
  }
  if (patch.description !== undefined && patch.description !== current.description) {
    columns.description = patch.description;
    events.push({ kind: 'description', from: null, to: null });
  }
  if (patch.status !== undefined && patch.status !== current.status) {
    columns.status = patch.status;
    events.push({ kind: 'status', from: current.status, to: patch.status });
    if (patch.status === 'done') completion = 'complete';
    else if (current.status === 'done') completion = 'reopen';
  }
  if (patch.priority !== undefined && patch.priority !== current.priority) {
    columns.priority = patch.priority;
    events.push({ kind: 'priority', from: current.priority, to: patch.priority });
  }
  if (patch.assignee !== undefined && !sameText(patch.assignee, current.assignee)) {
    columns.assignee = patch.assignee;
    events.push({ kind: 'assignee', from: current.assignee, to: patch.assignee });
  }
  if (patch.dueDate !== undefined && patch.dueDate !== current.dueDate) {
    columns.due_date = patch.dueDate;
    events.push({ kind: 'due_date', from: current.dueDate, to: patch.dueDate });
  }
  if (patch.projectId !== undefined && patch.projectId !== current.projectId) {
    columns.project_id = patch.projectId;
    events.push({
      kind: 'project',
      from: current.projectName,
      to: patch.projectId === null ? null : (patch.projectName ?? null),
    });
  }

  return { columns, events, completion };
}

/** E-Mail-Adressen ohne Ruecksicht auf Gross-/Kleinschreibung vergleichen. */
function sameText(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Ueberfaellig: ein Faelligkeitsdatum vor heute und noch nicht erledigt.
 * `today` als JJJJ-MM-TT; Datumstexte lassen sich so direkt vergleichen.
 */
export function isOverdue(task: { status: Status; dueDate: string | null }, today: string): boolean {
  return task.status !== 'done' && task.dueDate !== null && task.dueDate < today;
}

/** Ein Eintrag im Verlauf als Satz, z. B. "changed status from To do to Done". */
export function describeEvent(event: { kind: EventKind; from: string | null; to: string | null }): string {
  const value = (raw: string | null, empty: string): string => (raw === null || raw === '' ? empty : raw);
  switch (event.kind) {
    case 'created':
      return 'created the task';
    case 'status':
      return `moved it from ${statusLabel(event.from)} to ${statusLabel(event.to)}`;
    case 'priority':
      return `changed priority from ${priorityLabel(event.from)} to ${priorityLabel(event.to)}`;
    case 'assignee':
      return event.to === null
        ? `unassigned ${value(event.from, 'nobody')}`
        : `assigned it to ${event.to}`;
    case 'due_date':
      return event.to === null ? 'removed the due date' : `set the due date to ${event.to}`;
    case 'title':
      return `renamed it to "${value(event.to, '')}"`;
    case 'description':
      return 'edited the description';
    case 'project':
      return event.to === null
        ? `removed it from ${value(event.from, 'its project')}`
        : `moved it to project ${event.to}`;
  }
}

function statusLabel(raw: string | null): string {
  return isStatus(raw) ? STATUS_LABELS[raw] : (raw ?? 'nothing');
}

function priorityLabel(raw: string | null): string {
  return isPriority(raw) ? PRIORITY_LABELS[raw] : (raw ?? 'nothing');
}
