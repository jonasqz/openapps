/** `GET /api/agent-runs/:run` — ein Lauf (`get_agent_run`, ADR 0024 E). */

import { handleGetAgentRun } from '../../../../lib/agents-http';
import { domainContext } from '../../../../lib/runtime';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RouteParams {
  readonly params: Promise<{ readonly run: string }>;
}

export async function GET(request: Request, { params }: RouteParams): Promise<Response> {
  const { run } = await params;
  return handleGetAgentRun(domainContext(), request, run);
}
