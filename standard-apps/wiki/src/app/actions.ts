'use server';

import { headers } from 'next/headers';
import { getUser, ToolInputError, ToolNotFoundError } from '@openapps/sdk';
import type { ZodIssue } from 'zod';
import { archivePage, createPage, updatePage } from '@/lib/pages';
import { PagesArchiveArgs, PagesCreateArgs, PagesUpdateArgs } from '@/lib/schemas';

/**
 * Die Schreibwege der UI. Jede Action ist ein duenner Mantel um genau ein Tool
 * (`pages.create`, `pages.update`, `pages.archive`) — dieselbe Funktion,
 * dieselbe Pruefung. Es gibt keinen Weg, der nur in der UI existiert.
 *
 * Eine Server Action ist ein oeffentlicher POST-Endpunkt. Deshalb prueft jede
 * zuerst die Gateway-Signatur mit `getUser` und dann die Argumente — der
 * Aufrufer kann jeden Wert schicken, nicht nur den aus dem Formular.
 */

export type ActionResult =
  | { ok: true; id: string }
  | { ok: false; formError?: string; fieldErrors?: Record<string, string> };

const UNAUTHORIZED: ActionResult = {
  ok: false,
  formError: 'Nicht angemeldet: Die Anfrage kam nicht nachweisbar über das Gateway. Lade die Seite neu.',
};

async function actor(): Promise<string | undefined> {
  try {
    return getUser(await headers()).id;
  } catch {
    return undefined;
  }
}

/** Erster Fehler je oberstem Feld, so wie `FormPattern` ihn am Feld zeigt. */
function fieldErrors(issues: readonly ZodIssue[]): ActionResult {
  const errors: Record<string, string> = {};
  let formError: string | undefined;
  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field === 'string') {
      errors[field] ??= issue.message;
    } else {
      formError ??= issue.message;
    }
  }
  return {
    ok: false,
    fieldErrors: errors,
    formError: formError ?? 'Bitte prüfe die markierten Felder.',
  };
}

function failure(error: unknown, action: string): ActionResult {
  if (error instanceof ToolInputError || error instanceof ToolNotFoundError) {
    return { ok: false, formError: error.message };
  }
  console.error(`[wiki] ${action}:`, error);
  return { ok: false, formError: 'Speichern ist fehlgeschlagen. Versuche es gleich noch einmal.' };
}

export async function createPageAction(input: unknown): Promise<ActionResult> {
  const user = await actor();
  if (user === undefined) return UNAUTHORIZED;
  const parsed = PagesCreateArgs.safeParse(input);
  if (!parsed.success) return fieldErrors(parsed.error.issues);
  try {
    const page = await createPage(parsed.data, user);
    return { ok: true, id: page.id };
  } catch (error) {
    return failure(error, 'createPage');
  }
}

export async function updatePageAction(input: unknown): Promise<ActionResult> {
  const user = await actor();
  if (user === undefined) return UNAUTHORIZED;
  const parsed = PagesUpdateArgs.safeParse(input);
  if (!parsed.success) return fieldErrors(parsed.error.issues);
  try {
    const page = await updatePage(parsed.data, user);
    return { ok: true, id: page.id };
  } catch (error) {
    return failure(error, 'updatePage');
  }
}

export async function archivePageAction(input: unknown): Promise<ActionResult> {
  const user = await actor();
  if (user === undefined) return UNAUTHORIZED;
  const parsed = PagesArchiveArgs.safeParse(input);
  if (!parsed.success) return fieldErrors(parsed.error.issues);
  try {
    const result = await archivePage(parsed.data, user);
    return { ok: true, id: result.id };
  } catch (error) {
    return failure(error, 'archivePage');
  }
}
