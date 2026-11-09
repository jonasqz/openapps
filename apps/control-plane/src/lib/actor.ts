/**
 * Den Aufrufer einer HTTP-Route bestimmen. Ohne Session gibt es keinen Actor
 * und damit keinen Zugriff — es gibt keinen anonymen Pfad.
 */

import { PermissionDeniedError } from '../domain/errors';
import { actorFromSession, denyAllSessions, type SessionReader } from './session';
import type { Actor } from '../domain/types';

/**
 * Default-Deny, bis etwas anderes gesetzt ist. Der echte Leser kommt **lazy**
 * aus einer Fabrik, die `src/lib/runtime.ts` beim Import registriert: so
 * braucht kein Route-Handler eine Reihenfolge einzuhalten, und keine
 * Auth-Variable wird gelesen, solange niemand eine Session braucht.
 *
 * Ohne Fabrik und ohne gesetzten Leser bleibt es bei `denyAllSessions` — das
 * ist der Zustand in den Tests und der sichere Ausgangszustand.
 */
let reader: SessionReader | undefined;
let factory: (() => SessionReader) | undefined;

/** Setzt den Leser direkt (Tests, Skripte). */
export function setSessionReader(replacement: SessionReader): void {
  reader = replacement;
}

/** Registriert den Weg zum echten Leser, ohne ihn schon zu bauen. */
export function setSessionReaderFactory(replacement: () => SessionReader): void {
  factory = replacement;
}

/** Nur fuer Tests: zurueck auf Default-Deny. */
export function resetSessionReader(): void {
  reader = undefined;
  factory = undefined;
}

function sessionReader(): SessionReader {
  reader ??= factory === undefined ? denyAllSessions : factory();
  return reader;
}

export async function currentActor(request: Request): Promise<Actor> {
  const user = await sessionReader().read(request);
  if (user === null) {
    throw new PermissionDeniedError('keine Session');
  }
  return actorFromSession(user);
}

/**
 * Wie `currentActor`, nur ohne Ausnahme: `null` heisst „nicht angemeldet".
 * Dafuer gibt es einen eigenen Weg, weil eine Seite dann auf `/login` leitet,
 * statt einen Fehler zu zeigen — ein Endpunkt dagegen sperrt.
 */
export async function currentActorOrNull(request: Request): Promise<Actor | null> {
  const user = await sessionReader().read(request);
  return user === null ? null : actorFromSession(user);
}

export async function currentUser(request: Request): Promise<{
  userId: string;
  email: string;
  groups: readonly string[];
} | null> {
  return sessionReader().read(request);
}
