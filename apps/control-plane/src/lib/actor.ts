/**
 * Den Aufrufer einer HTTP-Route bestimmen. Ohne Session gibt es keinen Actor
 * und damit keinen Zugriff — es gibt keinen anonymen Pfad.
 */

import { PermissionDeniedError } from '../domain/errors';
import { actorFromSession, denyAllSessions, type SessionReader } from './session';
import type { Actor } from '../domain/types';

let reader: SessionReader = denyAllSessions;

/** Wird beim Start gesetzt, sobald Better Auth verdrahtet ist. */
export function setSessionReader(replacement: SessionReader): void {
  reader = replacement;
}

export async function currentActor(request: Request): Promise<Actor> {
  const user = await reader.read(request);
  if (user === null) {
    throw new PermissionDeniedError('keine Session');
  }
  return actorFromSession(user);
}

export async function currentUser(request: Request): Promise<{
  userId: string;
  email: string;
  groups: readonly string[];
} | null> {
  return reader.read(request);
}
