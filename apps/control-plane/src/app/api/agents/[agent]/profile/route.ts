/** `PUT /api/agents/:agent/profile` — Profil eines Plattform-Agents pflegen (`configure_agent`, ADR 0024 E). */

import { handleConfigureAgent } from '../../../../../lib/agents-http';
import { readEnv } from '../../../../../lib/env';
import { domainContext } from '../../../../../lib/runtime';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RouteParams {
  readonly params: Promise<{ readonly agent: string }>;
}

export async function PUT(request: Request, { params }: RouteParams): Promise<Response> {
  const { agent } = await params;
  return handleConfigureAgent(domainContext(), request, decodeURIComponent(agent), {
    controlPlaneHost: readEnv().controlPlaneHost,
  });
}
