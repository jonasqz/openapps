/**
 * `GET /api/refs/resolve?ref=…` und, umgeschrieben in `next.config.mjs`,
 * `GET /_platform/refs/resolve` auf dem Host der Apps: Verweise aufloesen
 * (ADR 0023 B, F). Die Pruefkette steht in `lib/refs-http.ts`.
 */

import { createHttpInvoker } from '../../../../infra/app-tool-invoker';
import { readEnv } from '../../../../lib/env';
import { lokalAppHref } from '../../../../lib/lokal-links';
import { sharedRefCache } from '../../../../lib/ref-cache';
import { handleResolveRefs } from '../../../../lib/refs-http';
import { domainContext } from '../../../../lib/runtime';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  const env = readEnv();
  const invoker = createHttpInvoker({ authMasterSecret: env.authMasterSecret });
  const appHref = lokalAppHref(request, env.controlPlaneHost);
  return handleResolveRefs(domainContext(), invoker, request, {
    cache: sharedRefCache(),
    ...(appHref === undefined ? {} : { appHref }),
  });
}
