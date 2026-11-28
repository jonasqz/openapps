import { actorOf, createEventOutbox, recipientOf, type PlatformEventInput } from '@openapps/sdk';
import { query, type Query } from './db';
import { STATUS_LABELS, type Status } from './workflow';

/**
 * Was Tasks der Plattform meldet (ADR 0022), so wie es in `app.json` unter
 * `events` steht:
 *
 * - `task.assigned`: jemandem zugewiesen, an die neue zustaendige Person.
 * - `task.commented`: ein Kommentar, an die zustaendige und die anlegende
 *   Person.
 * - `task.status_changed`: neuer Status, an dieselben.
 *
 * Wer davon eine Benachrichtigung bekommt, entscheidet die Plattform: nur,
 * wer Tasks lesen darf, und nie der Ausloeser. Hier steht kein Rechte-Code.
 * Jedes Ereignis geht in derselben Transaktion wie die Aenderung in die
 * Outbox; geliefert wird nach dem Commit (`kickEvents`).
 */

export const TASK_EVENT_TYPES = ['task.assigned', 'task.commented', 'task.status_changed'] as const;

export const taskEvents = createEventOutbox({ query, name: '[tasks] events' });

/** Reiht Ereignisse ein. Nur in der Transaktion der Aenderung. */
export async function emitTaskEvents(q: Query, events: readonly PlatformEventInput[]): Promise<void> {
  if (events.length === 0) return;
  await taskEvents.emit(q, events);
}

/** Nach dem Commit: liefern, ohne zu warten. Wirft nie. */
export function kickEvents(): void {
  taskEvents.kick();
}

interface TaskRef {
  id: string;
  title: string;
  assignee: string | null;
  createdBy: string;
}

const audienceOf = (...values: (string | null)[]): string[] =>
  [...new Set(values.map((value) => recipientOf(value)).filter((value) => value !== null))];

const pathOf = (taskId: string): string => `/task/${taskId}`;

/** `historyId` ist die Zeile in `task_events`: eindeutig, also die Id des Ereignisses. */
export function assignedEvent(task: TaskRef, historyId: string, actor: string): PlatformEventInput | null {
  const audience = audienceOf(task.assignee);
  if (audience.length === 0) return null;
  return {
    id: `task.assigned:${historyId}`,
    type: 'task.assigned',
    object: `task:${task.id}`,
    title: `Assigned to you: ${task.title}`,
    path: pathOf(task.id),
    actor: actorOf(actor),
    audience,
  };
}

export function statusChangedEvent(
  task: TaskRef,
  historyId: string,
  status: Status,
  actor: string,
): PlatformEventInput {
  return {
    id: `task.status_changed:${historyId}`,
    type: 'task.status_changed',
    object: `task:${task.id}`,
    title: `${task.title} is now ${STATUS_LABELS[status]}`,
    path: pathOf(task.id),
    actor: actorOf(actor),
    audience: audienceOf(task.assignee, task.createdBy),
  };
}

export function commentedEvent(task: TaskRef, commentId: string, author: string): PlatformEventInput {
  return {
    id: `task.commented:${commentId}`,
    type: 'task.commented',
    object: `task:${task.id}`,
    title: `New comment on ${task.title}`,
    path: pathOf(task.id),
    actor: actorOf(author),
    audience: audienceOf(task.assignee, task.createdBy),
  };
}
