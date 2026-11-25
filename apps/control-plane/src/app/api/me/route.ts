/**
 * `GET /api/me` — wer bin ich auf der Plattform. Dasselbe wie das MCP-Tool
 * `whoami` und die Seite `/settings` (ADR 0017).
 *
 * Ohne Session 403 wie jede andere Route unter `/api`; einen anonymen Pfad
 * gibt es nicht. Die Adresse kommt aus der Session, nicht aus der Anfrage.
 */

import { describeActor, PermissionDeniedError } from '../../../domain';
import { currentUser } from '../../../lib/actor';
import { errorResponse, jsonResponse } from '../../../lib/http';
import { domainContext } from '../../../lib/runtime';
import { actorFromSession } from '../../../lib/session';

export async function GET(request: Request): Promise<Response> {
  try {
    // Einmal lesen statt `currentActor` plus `currentUser`: Actor und Adresse
    // stammen so sicher aus derselben Session.
    const user = await currentUser(request);
    if (user === null) throw new PermissionDeniedError('no session');
    const me = await describeActor(domainContext(), actorFromSession(user), { email: user.email });
    return jsonResponse({ me });
  } catch (error) {
    return errorResponse(error);
  }
}
