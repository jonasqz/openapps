'use server';

import { getUser, ToolInputError, ToolNotFoundError, type PlatformUser } from '@openapps/sdk';
import { headers } from 'next/headers';
import { toolHandlers, type ToolName } from '@/lib/tools';
import { isStatus, type Status } from '@/lib/workflow';

/**
 * Die Mutationen der Oberfläche. Jede ruft genau ein Tool aus
 * src/lib/tools.ts — die UI hat keinen eigenen Weg in die Daten, und jede
 * Aktion hier hat ihr MCP-Tool. Ohne gültige Gateway-Signatur passiert nichts.
 *
 * Eingaben kommen aus dem Browser und werden nicht vorab geglaubt: Die Tools
 * pruefen sie mit denselben Schemas wie fuer Agents.
 */

export type FormInput = Record<string, string | boolean>;

export type ActionFailure = { ok: false; fieldErrors: Record<string, string>; formError?: string };

export type ActionResult = { ok: true; id: string } | ActionFailure;

export type StatusResult =
  | { ok: true; id: string; changed: boolean; previousStatus: Status }
  | ActionFailure;

async function currentUser(): Promise<PlatformUser | null> {
  try {
    return getUser(await headers());
  } catch {
    return null;
  }
}

function fieldErrorsOf(issues: readonly unknown[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    if (typeof issue !== 'object' || issue === null) continue;
    const { path, message } = issue as { path?: unknown; message?: unknown };
    const field = Array.isArray(path) && typeof path[0] === 'string' ? path[0] : undefined;
    if (field !== undefined && typeof message === 'string' && errors[field] === undefined) {
      errors[field] = message;
    }
  }
  return errors;
}

const NOT_SIGNED_IN: ActionFailure = {
  ok: false,
  fieldErrors: {},
  formError: 'Not signed in: the request did not come through the gateway. Reload the page.',
};

/**
 * Ruft ein Tool im Namen der angemeldeten Person. `pick` holt aus der Antwort,
 * was die Oberflaeche braucht.
 */
async function runTool<T extends { ok: true }>(
  name: ToolName,
  args: Record<string, unknown>,
  pick: (result: unknown) => T,
  user?: PlatformUser,
): Promise<T | ActionFailure> {
  const caller = user ?? (await currentUser());
  if (caller === null) return NOT_SIGNED_IN;
  try {
    return pick(await toolHandlers[name](args, { user: caller }));
  } catch (error) {
    if (error instanceof ToolInputError) {
      const fieldErrors = fieldErrorsOf(error.issues);
      const first = Object.values(fieldErrors)[0];
      return {
        ok: false,
        fieldErrors,
        formError:
          Object.keys(fieldErrors).length > 1
            ? 'Check the highlighted fields.'
            : (first ?? error.message),
      };
    }
    if (error instanceof ToolNotFoundError) {
      return { ok: false, fieldErrors: {}, formError: error.message };
    }
    console.error(`[tasks] ${name}:`, error);
    return { ok: false, fieldErrors: {}, formError: 'Saving failed. Try again in a moment.' };
  }
}

/** Liest `{ <key>: { id } }` aus einer Tool-Antwort. */
function idOf(key: 'task' | 'comment' | 'project') {
  return (result: unknown): { ok: true; id: string } => {
    const id = (result as Record<string, { id?: unknown } | undefined>)[key]?.id;
    if (typeof id !== 'string') throw new Error(`tool response without ${key}.id`);
    return { ok: true, id };
  };
}

function statusOf(result: unknown): { ok: true; id: string; changed: boolean; previousStatus: Status } {
  const { task, changed, previousStatus } = result as {
    task?: { id?: unknown };
    changed?: unknown;
    previousStatus?: unknown;
  };
  if (typeof task?.id !== 'string' || typeof changed !== 'boolean' || !isStatus(previousStatus)) {
    throw new Error('tool response without task, changed or previousStatus');
  }
  return { ok: true, id: task.id, changed, previousStatus };
}

function text(values: FormInput, key: string): string {
  const value = values[key];
  return typeof value === 'string' ? value.trim() : '';
}

/** Tool `tasks.create`. Leere Felder fallen weg. */
export async function createTaskAction(values: FormInput): Promise<ActionResult> {
  const args: Record<string, string> = {};
  for (const key of ['title', 'assignee', 'dueDate', 'priority', 'status', 'projectId'] as const) {
    const value = text(values, key);
    if (value !== '') args[key] = value;
  }
  const description = typeof values.description === 'string' ? values.description : '';
  if (description.trim() !== '') args.description = description;
  return runTool('tasks.create', args, idOf('task'));
}

/**
 * Tool `tasks.update` aus dem Bearbeiten-Formular. Nur geaenderte Felder
 * gehen mit; ein geleertes Feld wird zu `null` (Zuweisung, Datum, Projekt).
 * So scheitert ein Speichern nicht an einem alten Wert, den niemand anfasste.
 */
export async function editTaskAction(
  id: string,
  values: FormInput,
  initial: FormInput,
): Promise<ActionResult> {
  const args: Record<string, unknown> = { id };
  for (const key of ['title', 'assignee', 'dueDate', 'priority', 'status', 'projectId'] as const) {
    const value = text(values, key);
    if (value === text(initial, key)) continue;
    const nullable = key === 'assignee' || key === 'dueDate' || key === 'projectId';
    args[key] = value === '' && nullable ? null : value;
  }
  const description = typeof values.description === 'string' ? values.description : '';
  const before = typeof initial.description === 'string' ? initial.description : '';
  if (description !== before) args.description = description;
  if (Object.keys(args).length === 1) return { ok: true, id };
  return runTool('tasks.update', args, (result) => ({ ok: true, id: statusOf(result).id }));
}

/** Tool `tasks.complete`. */
export async function completeTaskAction(id: string): Promise<StatusResult> {
  return runTool('tasks.complete', { id }, statusOf);
}

/** Tool `tasks.update` mit nur dem Status (Board, Detailseite). */
export async function setStatusAction(id: string, status: string): Promise<StatusResult> {
  return runTool('tasks.update', { id, status }, statusOf);
}

/**
 * Undo nach "Erledigt": Tool `tasks.update` zurueck auf den vorigen Status,
 * aber nur, wenn die Aufgabe noch Done ist (`expectedStatus`). Hat jemand sie
 * inzwischen anders gesetzt, bleibt sie, wie sie ist, und die Meldung sagt es.
 */
export async function undoCompleteAction(id: string, previousStatus: string): Promise<StatusResult> {
  return runTool('tasks.update', { id, status: previousStatus, expectedStatus: 'done' }, statusOf);
}

/** Tool `tasks.assign` mit der E-Mail der angemeldeten Person. */
export async function assignToMeAction(id: string): Promise<StatusResult> {
  const user = await currentUser();
  if (user === null) return NOT_SIGNED_IN;
  return runTool('tasks.assign', { id, assignee: user.email }, statusOf, user);
}

/** Tool `tasks.assign` mit `null`. */
export async function unassignAction(id: string): Promise<StatusResult> {
  return runTool('tasks.assign', { id, assignee: null }, statusOf);
}

/** Tool `tasks.comment`. */
export async function commentAction(id: string, body: string): Promise<ActionResult> {
  return runTool('tasks.comment', { id, body }, idOf('comment'));
}

/** Tool `projects.create`. */
export async function createProjectAction(values: FormInput): Promise<ActionResult> {
  const args: Record<string, string> = { name: text(values, 'name') };
  const description = text(values, 'description');
  if (description !== '') args.description = description;
  return runTool('projects.create', args, idOf('project'));
}
