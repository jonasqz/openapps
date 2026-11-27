/**
 * `GET /api/search` und, umgeschrieben in `next.config.mjs`,
 * `GET /_platform/search` auf dem Host der Apps — die Suche ueber alle Apps
 * (ADR 0021). Die Pruefkette steht in `lib/platform-search-http.ts`.
 */

import { appPathFor } from '../../../domain';
import { createHttpInvoker } from '../../../infra/app-tool-invoker';
import { DEFAULT_ANSICHT_ORIGIN } from '../../../infra/lokal-ansehen';
import { readEnv } from '../../../lib/env';
import { handlePlatformSearch } from '../../../lib/platform-search-http';
import { domainContext } from '../../../lib/runtime';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  const env = readEnv();
  const invoker = createHttpInvoker({ authMasterSecret: env.authMasterSecret });
  return handlePlatformSearch(domainContext(), invoker, request, lokalLinks(request, env));
}

/**
 * Im lokalen Betrieb zeigen die Links der Verwaltung auf den Ansehen-Proxy
 * (wie `lib/shell-nav.ts`), weil es die Hosts des Servers am Loopback nicht
 * gibt. Ueber das lokale Gateway (Host der Apps) bleibt es bei dessen Links.
 */
function lokalLinks(
  request: Request,
  env: { readonly controlPlaneHost: string },
): Parameters<typeof handlePlatformSearch>[3] {
  if (process.env.OPENAPPS_BACKEND !== 'lokal') return {};
  const raw = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? '';
  const host = raw.trim().toLowerCase().split(':')[0] ?? '';
  if (host !== env.controlPlaneHost) return {};
  const origin = (process.env.ANSEHEN_ORIGIN ?? DEFAULT_ANSICHT_ORIGIN).replace(/\/+$/, '');
  return { appHref: (app) => `${origin}${appPathFor(app.name)}` };
}
