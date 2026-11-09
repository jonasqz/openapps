/** `POST /api/apps/:app/rollback` — zurueck auf die Vorversion (DoD 5). */

import { rollback } from '../../../../../domain';
import { currentActor } from '../../../../../lib/actor';
import { errorResponse, jsonResponse } from '../../../../../lib/http';
import { domainContext } from '../../../../../lib/runtime';

interface RouteParams {
  readonly params: Promise<{ readonly app: string }>;
}

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  try {
    const actor = await currentActor(request);
    const { app } = await params;
    const deployment = await rollback(domainContext(), { actor, appIdOrName: app });
    return jsonResponse({ deployment });
  } catch (error) {
    return errorResponse(error);
  }
}
