/**
 * `POST /api/inbox/summary` — KI-Zusammenfassung des eigenen Eingangs
 * (ADR 0022 Schritt 7, ADR 0024). Ohne Chat-Modell 503 `not_configured`.
 */

import { handleInboxSummary } from '../../../../lib/agents-http';
import { readEnv } from '../../../../lib/env';
import { domainContext } from '../../../../lib/runtime';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  return handleInboxSummary(domainContext(), request, {
    controlPlaneHost: readEnv().controlPlaneHost,
  });
}
