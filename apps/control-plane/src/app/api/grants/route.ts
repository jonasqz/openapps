/** `GET /api/grants` und `POST /api/grants` — das Rechtemodell ueber HTTP. */

import { grant, listGrants } from '../../../domain';
import type { ResourceKind, SubjectKind, Verb } from '../../../domain/types';
import { currentActor } from '../../../lib/actor';
import { errorResponse, jsonResponse, readJson } from '../../../lib/http';
import { domainContext } from '../../../lib/runtime';

export async function GET(request: Request): Promise<Response> {
  try {
    const actor = await currentActor(request);
    const url = new URL(request.url);
    const resourceKind = url.searchParams.get('resourceKind');
    const resourceId = url.searchParams.get('resourceId');
    const grants = await listGrants(domainContext(), {
      actor,
      ...(resourceKind !== null && resourceId !== null
        ? { resource: { kind: resourceKind as ResourceKind, id: resourceId } }
        : {}),
    });
    return jsonResponse({ grants });
  } catch (error) {
    return errorResponse(error);
  }
}

interface GrantBody {
  readonly subjectKind?: SubjectKind;
  readonly subjectId?: string;
  readonly verb?: Verb;
  readonly resourceKind?: ResourceKind;
  readonly resourceId?: string;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await currentActor(request);
    const body = await readJson<GrantBody>(request);
    if (
      body.subjectKind === undefined ||
      body.subjectId === undefined ||
      body.verb === undefined ||
      body.resourceKind === undefined ||
      body.resourceId === undefined
    ) {
      return jsonResponse(
        {
          error: 'validation_failed',
          message: 'subjectKind, subjectId, verb, resourceKind und resourceId sind nötig',
        },
        422,
      );
    }
    const created = await grant(domainContext(), {
      actor,
      subject: { kind: body.subjectKind, id: body.subjectId },
      verb: body.verb,
      resource: { kind: body.resourceKind, id: body.resourceId },
    });
    return jsonResponse({ grant: created }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
