/**
 * `GET`, `POST` und `DELETE /api/groups/<gruppe>/members` — Mitgliedschaften.
 *
 * `DELETE` statt `POST` mit einem Feld `remove`: Entfernen ist eine eigene
 * Aktion mit eigenem Recht-Nachweis und eigenem Audit-Eintrag
 * (`revoke_group_member`), und ein Werkzeug soll sie nicht aus Versehen beim
 * Aufnehmen mitnehmen. Die Adresse steht im Pfad, nicht im Rumpf — ein
 * `DELETE` ohne Rumpf geht durch jeden Proxy.
 */

import { addGroupMember, listGroupMembers, removeGroupMember } from '../../../../../domain';
import { currentActor } from '../../../../../lib/actor';
import { errorResponse, jsonResponse, readJson } from '../../../../../lib/http';
import { domainContext } from '../../../../../lib/runtime';

interface RouteContext {
  readonly params: Promise<{ readonly group: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const actor = await currentActor(request);
    const { group } = await context.params;
    const members = await listGroupMembers(domainContext(), { actor, group });
    return jsonResponse({ group, members });
  } catch (error) {
    return errorResponse(error);
  }
}

interface MemberBody {
  readonly email?: string;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const actor = await currentActor(request);
    const { group } = await context.params;
    const body = await readJson<MemberBody>(request);
    if (body.email === undefined) {
      return jsonResponse({ error: 'validation_failed', message: 'email ist nötig' }, 422);
    }
    const result = await addGroupMember(domainContext(), { actor, group, email: body.email });
    // 200, nicht 201: Der Aufruf ist idempotent, und `added: false` heisst
    // „war schon Mitglied". Ein 201 waere eine Zusage, dass etwas entstanden
    // ist.
    return jsonResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    const actor = await currentActor(request);
    const { group } = await context.params;
    const email = new URL(request.url).searchParams.get('email');
    if (email === null) {
      return jsonResponse(
        { error: 'validation_failed', message: 'email als Parameter ist nötig' },
        422,
      );
    }
    const result = await removeGroupMember(domainContext(), { actor, group, email });
    return jsonResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
}
