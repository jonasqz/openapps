/**
 * `POST /api/inbox/mark` — Eintraege im eigenen Eingang als gelesen,
 * ungelesen oder erledigt markieren (ADR 0022 D). Nur auf dem Host der
 * Control Plane. Die Pruefkette steht in `lib/inbox-http.ts`.
 */

import { readEnv } from '../../../../lib/env';
import { handleInboxMark } from '../../../../lib/inbox-http';
import { domainContext } from '../../../../lib/runtime';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  return handleInboxMark(domainContext(), request, {
    controlPlaneHost: readEnv().controlPlaneHost,
  });
}
