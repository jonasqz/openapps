/**
 * `GET /api/agents` und `POST /api/agents` — Agent-Identitaeten ueber HTTP.
 *
 * Die Entscheidung liegt in der Domaene (`src/domain/agents.ts`). Wichtig an
 * der Antwort auf `POST`: Sie enthaelt das Secret und das fertige Token — und
 * es ist die **einzige** Antwort, die das je tut. Gespeichert wird nur der
 * Hash.
 */

import { createAgentIdentity, listAgentIdentities } from '../../../domain';
import { currentActor } from '../../../lib/actor';
import { errorResponse, jsonResponse, readJson } from '../../../lib/http';
import { domainContext } from '../../../lib/runtime';

export async function GET(request: Request): Promise<Response> {
  try {
    const actor = await currentActor(request);
    const agents = await listAgentIdentities(domainContext(), { actor });
    return jsonResponse({ agents });
  } catch (error) {
    return errorResponse(error);
  }
}

interface CreateAgentBody {
  readonly name?: string;
  readonly displayName?: string;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await currentActor(request);
    const body = await readJson<CreateAgentBody>(request);
    if (typeof body.name !== 'string') {
      return jsonResponse({ error: 'validation_failed', message: 'name ist nötig' }, 422);
    }
    const created = await createAgentIdentity(domainContext(), {
      actor,
      name: body.name,
      ...(typeof body.displayName === 'string' ? { displayName: body.displayName } : {}),
    });
    const response = jsonResponse(created, 201);
    // Die Antwort traegt ein Secret: kein Zwischenspeicher soll sie behalten.
    response.headers.set('cache-control', 'no-store');
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
