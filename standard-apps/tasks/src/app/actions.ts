'use server';

import { getUser, ToolInputError, ToolNotFoundError, type PlatformUser } from '@openapps/sdk';
import { headers } from 'next/headers';
import { toolHandlers, type ToolName } from '@/lib/tools';

/**
 * Die Mutationen der Oberfläche. Jede ruft genau ein Tool aus
 * src/lib/tools.ts — die UI hat keinen eigenen Weg in die Daten, und jede
 * Aktion hier hat ihr MCP-Tool. Ohne gültige Gateway-Signatur passiert nichts.
 */

export type FormInput = Record<string, string | boolean>;

export type ActionResult =
  | { ok: true; id: string }
  | { ok: false; fieldErrors: Record<string, string>; formError?: string };

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

async function runTool(name: ToolName, args: Record<string, unknown>): Promise<ActionResult> {
  const user = await currentUser();
  if (user === null) {
    return {
      ok: false,
      fieldErrors: {},
      formError: 'Not signed in: the request did not come through the gateway. Reload the page.',
    };
  }
  try {
    const result = (await toolHandlers[name](args, { user })) as { task?: { id?: unknown } };
    const id = result.task?.id;
    if (typeof id !== 'string') throw new Error('tool response without task.id');
    return { ok: true, id };
  } catch (error) {
    if (error instanceof ToolInputError) {
      const fieldErrors = fieldErrorsOf(error.issues);
      return {
        ok: false,
        fieldErrors,
        formError:
          Object.keys(fieldErrors).length > 0 ? 'Check the highlighted fields.' : error.message,
      };
    }
    if (error instanceof ToolNotFoundError) {
      return { ok: false, fieldErrors: {}, formError: error.message };
    }
    console.error(`[tasks] ${name}:`, error);
    return {
      ok: false,
      fieldErrors: {},
      formError: 'Saving failed. Try again in a moment.',
    };
  }
}

/** Tool `tasks.create`. Leere Felder fallen weg. */
export async function createTaskAction(values: FormInput): Promise<ActionResult> {
  const args: Record<string, string> = {};
  for (const key of ['title', 'assignee', 'dueDate'] as const) {
    const value = values[key];
    if (typeof value === 'string' && value.trim() !== '') args[key] = value;
  }
  return runTool('tasks.create', args);
}

/** Tool `tasks.complete`. */
export async function completeTaskAction(id: string): Promise<ActionResult> {
  return runTool('tasks.complete', { id });
}
