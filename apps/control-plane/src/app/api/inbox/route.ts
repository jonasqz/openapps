/**
 * `GET /api/inbox` und, umgeschrieben in `next.config.mjs`,
 * `GET /_platform/inbox` auf dem Host der Apps — der eigene Eingang
 * (ADR 0022 D). Die Pruefkette steht in `lib/inbox-http.ts`.
 */

import { handleInboxList } from '../../../lib/inbox-http';
import { lokalAppHref } from '../../../lib/lokal-links';
import { readEnv } from '../../../lib/env';
import { domainContext } from '../../../lib/runtime';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  const appHref = lokalAppHref(request, readEnv().controlPlaneHost);
  return handleInboxList(domainContext(), request, appHref === undefined ? {} : { appHref });
}
