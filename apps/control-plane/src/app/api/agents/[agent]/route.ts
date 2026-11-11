/**
 * `DELETE /api/agents/<name>` — eine Agent-Identitaet sperren.
 *
 * `DELETE`, obwohl nichts geloescht wird: Fuer den Aufrufer ist der Zugang
 * danach weg, und das ist das Verb, das ein Werkzeug dafuer erwartet. Die
 * Zeile bleibt stehen, damit `agent:<name>` im Audit-Log weiter auf denselben
 * Agent zeigt (src/domain/agents.ts, Punkt 3).
 */

import { disableAgentIdentity } from '../../../../domain';
import { currentActor } from '../../../../lib/actor';
import { errorResponse, jsonResponse } from '../../../../lib/http';
import { domainContext } from '../../../../lib/runtime';

interface RouteContext {
  readonly params: Promise<{ readonly agent: string }>;
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    const actor = await currentActor(request);
    const { agent } = await context.params;
    return jsonResponse(await disableAgentIdentity(domainContext(), { actor, name: agent }));
  } catch (error) {
    return errorResponse(error);
  }
}
