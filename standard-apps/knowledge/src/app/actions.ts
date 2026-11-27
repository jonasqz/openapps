'use server';

import { getUser, ToolInputError, ToolNotFoundError, type PlatformUser } from '@openapps/sdk';
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
  'Your sign-in could not be confirmed. Reload the page and try again.';

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
    revalidatePath('/documents');
    return { ok: true, ...created };
  } catch (error) {
    console.error('[knowledge] addDocumentAction:', error);
    return {
      ok: false,
      formError: 'The document could not be saved. Try again in a moment.',
    };
  }
}

export async function deleteDocumentAction(id: string): Promise<DeleteDocumentResult> {
  const user = await currentUser();
  if (user === null) return { ok: false, message: UNAUTHORIZED };

  const parsed = DeleteArgs.safeParse({ id });
  if (!parsed.success) return { ok: false, message: 'This document does not exist.' };

  try {
    await deleteDocument(parsed.data.id);
    revalidatePath('/documents');
    return { ok: true };
  } catch (error) {
    if (error instanceof ToolNotFoundError) {
      return { ok: false, message: 'This document no longer exists or has already been deleted.' };
    }
    if (error instanceof ToolInputError) {
      // Ein Dokument einer Quell-App: die Meldung sagt, wo es gepflegt wird.
      return { ok: false, message: error.message };
    }
    console.error('[knowledge] deleteDocumentAction:', error);
    return { ok: false, message: 'The document could not be deleted. Try again in a moment.' };
  }
}

/** Meldungen fuer Menschen; die Befunde aus zod sind fuer Agents geschrieben. */
function fieldMessage(field: string, code: string): string {
  if (field === 'title') {
    return code === 'too_big' ? 'At most 200 characters.' : 'Enter a title.';
  }
  if (field === 'source') return 'The source can have at most 500 characters.';
  if (field === 'content') {
    return code === 'too_big'
      ? 'The text is too long (at most 200,000 characters).'
      : 'Paste the text of the document.';
  }
  return 'This value is not valid.';
}
