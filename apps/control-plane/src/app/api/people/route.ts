/**
 * `GET /api/people?app=…&q=…` und `GET /_platform/people`: wer in einer App
 * erwaehnt werden kann, nur fuer jemanden, der die App selbst lesen darf
 * (ADR 0023 D, F). Die Pruefkette steht in `lib/refs-http.ts`.
 */

import { handlePeople } from '../../../lib/refs-http';
import { domainContext } from '../../../lib/runtime';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  return handlePeople(domainContext(), request);
}
