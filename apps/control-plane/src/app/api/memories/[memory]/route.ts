/** `DELETE /api/memories/:memory` — einen Eintrag hart loeschen (`forget`, ADR 0024 F). */

import { handleForget } from '../../../../lib/agents-http';
import { readEnv } from '../../../../lib/env';
import { domainContext } from '../../../../lib/runtime';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RouteParams {
  readonly params: Promise<{ readonly memory: string }>;
}

export async function DELETE(request: Request, { params }: RouteParams): Promise<Response> {
  const { memory } = await params;
  return handleForget(domainContext(), request, memory, {
    controlPlaneHost: readEnv().controlPlaneHost,
  });
}
