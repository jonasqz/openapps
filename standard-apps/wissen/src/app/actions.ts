'use server';

import { getUser, ToolNotFoundError, type PlatformUser } from '@openapps/sdk';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { addDocument, deleteDocument } from '@/lib/documents';
import { DeleteArgs, DocumentInput } from '@/lib/schemas';

/**
 * Die Mutationen der UI. Jede hat ihr Tool (`documents.add`,
 * `documents.delete`) und ruft dieselbe Fachlogik mit denselben Schemas —
 * die UI kann nichts, was ein Agent nicht auch kann.
 *
 * Jede Action prueft zuerst die Gateway-Signatur mit `getUser`. Eine Server
 * Action ist ein oeffentlicher POST-Endpunkt; ohne diese Pruefung koennte ihn
 * jeder aufrufen, der die Action-Id kennt.
 */

export type AddDocumentResult =
  | { ok: true; id: string; chunkCount: number }
  | { ok: false; fieldErrors?: Record<string, string>; formError?: string };

export type DeleteDocumentResult = { ok: true } | { ok: false; message: string };

const UNAUTHORIZED =
  'Die Anmeldung konnte nicht bestätigt werden. Lade die Seite neu und versuche es noch einmal.';

async function currentUser(): Promise<PlatformUser | null> {
  try {
    return getUser(await headers());
  } catch {
    return null;
  }
}

export async function addDocumentAction(input: {
  title: string;
  source: string;
  content: string;
}): Promise<AddDocumentResult> {
  const user = await currentUser();
  if (user === null) return { ok: false, formError: UNAUTHORIZED };

  const parsed = DocumentInput.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? '');
      fieldErrors[field] ??= fieldMessage(field, issue.code);
    }
    return { ok: false, fieldErrors };
  }

  try {
    const created = await addDocument(parsed.data, user.id);
    revalidatePath('/dokumente');
    return { ok: true, ...created };
  } catch (error) {
    console.error('[wissen] addDocumentAction:', error);
    return {
      ok: false,
      formError: 'Das Dokument konnte nicht gespeichert werden. Versuche es gleich noch einmal.',
    };
  }
}

export async function deleteDocumentAction(id: string): Promise<DeleteDocumentResult> {
  const user = await currentUser();
  if (user === null) return { ok: false, message: UNAUTHORIZED };

  const parsed = DeleteArgs.safeParse({ id });
  if (!parsed.success) return { ok: false, message: 'Dieses Dokument gibt es nicht.' };

  try {
    await deleteDocument(parsed.data.id);
    revalidatePath('/dokumente');
    return { ok: true };
  } catch (error) {
    if (error instanceof ToolNotFoundError) {
      return { ok: false, message: 'Dieses Dokument gibt es nicht mehr oder es ist schon gelöscht.' };
    }
    console.error('[wissen] deleteDocumentAction:', error);
    return { ok: false, message: 'Das Dokument konnte nicht gelöscht werden. Versuche es gleich noch einmal.' };
  }
}

/** Meldungen fuer Menschen; die Befunde aus zod sind fuer Agents geschrieben. */
function fieldMessage(field: string, code: string): string {
  if (field === 'title') {
    return code === 'too_big' ? 'Höchstens 200 Zeichen.' : 'Bitte gib einen Titel ein.';
  }
  if (field === 'source') return 'Die Quelle darf höchstens 500 Zeichen haben.';
  if (field === 'content') {
    return code === 'too_big'
      ? 'Der Text ist zu lang (höchstens 200.000 Zeichen).'
      : 'Bitte füge den Text des Dokuments ein.';
  }
  return 'Diese Angabe ist ungültig.';
}
