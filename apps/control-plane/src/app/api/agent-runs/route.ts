/**
 * `GET /api/agent-runs` (`list_agent_runs`) und `POST /api/agent-runs`
 * (`start_agent_run`, „Ask agent“ im Home), ADR 0024 E.
 */

import { handleListAgentRuns, handleStartAgentRun } from '../../../lib/agents-http';
import { readEnv } from '../../../lib/env';
import { domainContext } from '../../../lib/runtime';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  return handleListAgentRuns(domainContext(), request);
}

export async function POST(request: Request): Promise<Response> {
  return handleStartAgentRun(domainContext(), request, {
    controlPlaneHost: readEnv().controlPlaneHost,
  });
}
