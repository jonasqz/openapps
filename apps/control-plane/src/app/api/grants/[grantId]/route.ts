/** `DELETE /api/grants/:grantId` — Widerruf. Wirkt sofort, ohne Cache (DoD 3). */

import { revoke } from '../../../../domain';
import { currentActor } from '../../../../lib/actor';
import { errorResponse, jsonResponse } from '../../../../lib/http';
import { domainContext } from '../../../../lib/runtime';

interface RouteParams {
  readonly params: Promise<{ readonly grantId: string }>;
}

export async function DELETE(request: Request, { params }: RouteParams): Promise<Response> {
  try {
    const actor = await currentActor(request);
    const { grantId } = await params;
    const revoked = await revoke(domainContext(), { actor, grantId });
    return jsonResponse({ grant: revoked });
  } catch (error) {
    return errorResponse(error);
  }
}
