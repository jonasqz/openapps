import { getUser, type PlatformUser } from '@openapps/sdk';
import { headers } from 'next/headers';

/**
 * Wer die Seite gerade ansieht, nur im Server. Ohne gueltige Signatur des
 * Gateways `null` — dann zeigt eine Seite, die die Person braucht ("My
 * tasks"), ihren Fehlerzustand. Kein Rechte-Code: ob die Person die App
 * sehen darf, hat das Gateway schon entschieden.
 */
export async function currentUser(): Promise<PlatformUser | null> {
  try {
    return getUser(await headers());
  } catch {
    return null;
  }
}
