/** `GET /api/memories` — Team-Gedaechtnis: `?q=` sucht (`recall`), sonst `list_memories` (ADR 0024 F). */

import { handleMemories } from '../../../lib/agents-http';
import { domainContext } from '../../../lib/runtime';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  return handleMemories(domainContext(), request);
}
