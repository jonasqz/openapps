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
      formError: 'Nicht angemeldet: Die Anfrage kam nicht über das Gateway. Lade die Seite neu.',
    };
  }
  try {
    const result = (await toolHandlers[name](args, { user })) as { aufgabe?: { id?: unknown } };
    const id = result.aufgabe?.id;
    if (typeof id !== 'string') throw new Error('Tool-Antwort ohne aufgabe.id');
    return { ok: true, id };
  } catch (error) {
    if (error instanceof ToolInputError) {
      const fieldErrors = fieldErrorsOf(error.issues);
      return {
        ok: false,
        fieldErrors,
        formError:
          Object.keys(fieldErrors).length > 0 ? 'Bitte die markierten Felder prüfen.' : error.message,
      };
    }
    if (error instanceof ToolNotFoundError) {
      return { ok: false, fieldErrors: {}, formError: error.message };
    }
    console.error(`[aufgaben] ${name}:`, error);
    return {
      ok: false,
      fieldErrors: {},
      formError: 'Speichern ist fehlgeschlagen. Versuche es gleich noch einmal.',
    };
  }
}

/** Tool `aufgaben.create`. Leere Felder fallen weg. */
export async function createAufgabeAction(values: FormInput): Promise<ActionResult> {
  const args: Record<string, string> = {};
  for (const key of ['titel', 'zustaendig', 'faelligAm'] as const) {
    const value = values[key];
    if (typeof value === 'string' && value.trim() !== '') args[key] = value;
  }
  return runTool('aufgaben.create', args);
}

/** Tool `aufgaben.erledigen`. */
export async function erledigeAufgabeAction(id: string): Promise<ActionResult> {
  return runTool('aufgaben.erledigen', { id });
}
