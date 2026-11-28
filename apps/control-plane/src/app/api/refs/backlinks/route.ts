/**
 * `GET /api/refs/backlinks?ref=…` und `GET /_platform/refs/backlinks`:
 * eingehende Verweise, nur wenn Ziel- und Quell-App lesbar sind
 * (ADR 0023 C, F). Die Pruefkette steht in `lib/refs-http.ts`.
 */

import { handleBacklinks } from '../../../../lib/refs-http';
import { domainContext } from '../../../../lib/runtime';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  return handleBacklinks(domainContext(), request);
}
