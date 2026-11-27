import { getUser } from '@openapps/sdk';
import { headers } from 'next/headers';

/**
 * Wer die Seite gerade ansieht, fuer persoenliche Anzeigen (Favoriten). Nur im
 * Server aufrufen. Kein Rechte-Code: Ob die Person die App sehen darf, hat das
 * Gateway entschieden; ohne gueltige Signatur gibt es hier `undefined`, und
 * die Seite zeigt keine persoenlichen Daten.
 */
export async function viewerId(): Promise<string | undefined> {
  try {
    return getUser(await headers()).id;
  } catch {
    return undefined;
  }
}
