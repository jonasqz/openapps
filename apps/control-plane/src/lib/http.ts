/**
 * Uebersetzung zwischen HTTP und Domaene. Die Route-Handler sollen nichts
 * anderes tun als: Aufrufer bestimmen, Domaenenfunktion rufen, Fehler abbilden.
 */

import {
  ConflictError,
  DomainError,
  NotFoundError,
  PermissionDeniedError,
  ReviewBlockedError,
  ValidationError,
} from '../domain/errors';

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof PermissionDeniedError) {
    return jsonResponse({ error: error.code, message: error.message }, 403);
  }
  if (error instanceof NotFoundError) {
    return jsonResponse({ error: error.code, message: error.message }, 404);
  }
  if (error instanceof ConflictError) {
    return jsonResponse({ error: error.code, message: error.message }, 409);
  }
  if (error instanceof ValidationError) {
    return jsonResponse({ error: error.code, message: error.message }, 422);
  }
  if (error instanceof ReviewBlockedError) {
    return jsonResponse(
      { error: error.code, message: error.message, deploymentId: error.deploymentId },
      422,
    );
  }
  if (error instanceof DomainError) {
    return jsonResponse({ error: error.code, message: error.message }, 400);
  }
  // Nach aussen nichts ueber das Innere verraten.
  return jsonResponse({ error: 'internal_error', message: 'unerwarteter Fehler' }, 500);
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new ValidationError('Body ist kein gueltiges JSON');
  }
}
