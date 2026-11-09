/**
 * `GET /api/groups` und `POST /api/groups` — Gruppen ueber HTTP.
 *
 * Gruppen sind Teil des Rechtemodells (Migration 0009 und 0011), also liegt
 * die Entscheidung in der Domaene und nicht hier: Diese Datei bestimmt den
 * Aufrufer, ruft die Domaenenfunktion und bildet den Fehler ab.
 */

import { createGroup, listGroups } from '../../../domain';
import { currentActor } from '../../../lib/actor';
import { errorResponse, jsonResponse, readJson } from '../../../lib/http';
import { domainContext } from '../../../lib/runtime';

export async function GET(request: Request): Promise<Response> {
  try {
    const actor = await currentActor(request);
    const groups = await listGroups(domainContext(), { actor });
    return jsonResponse({ groups });
  } catch (error) {
    return errorResponse(error);
  }
}

interface CreateGroupBody {
  readonly name?: string;
  readonly description?: string;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await currentActor(request);
    const body = await readJson<CreateGroupBody>(request);
    if (body.name === undefined) {
      return jsonResponse({ error: 'validation_failed', message: 'name ist nötig' }, 422);
    }
    const group = await createGroup(domainContext(), {
      actor,
      name: body.name,
      ...(body.description === undefined ? {} : { description: body.description }),
    });
    return jsonResponse({ group }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
