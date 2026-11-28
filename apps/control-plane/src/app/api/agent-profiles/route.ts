/** `GET /api/agent-profiles` — Plattform-Agents, die der Aufrufer sehen oder starten darf (ADR 0024 E). */

import { handleListAgentProfiles } from '../../../lib/agents-http';
import { domainContext } from '../../../lib/runtime';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  return handleListAgentProfiles(domainContext(), request);
}
