/**
 * `GET /api/refs/actions?ref=…&excerpt=…` und `GET /_platform/refs/actions`:
 * die Aktionen „aus X wird Y“ fuer die Person, mit Adresse in der Ziel-App
 * (ADR 0023 E, F). Die Pruefkette steht in `lib/refs-http.ts`.
 */

import { readEnv } from '../../../../lib/env';
import { lokalAppHref } from '../../../../lib/lokal-links';
import { handleActions } from '../../../../lib/refs-http';
import { domainContext } from '../../../../lib/runtime';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  const appHref = lokalAppHref(request, readEnv().controlPlaneHost);
  return handleActions(domainContext(), request, appHref === undefined ? {} : { appHref });
}
