/**
 * `/api/auth/*` — alles, was Better Auth selbst bedient: den Start des
 * Google-Logins, den OAuth-Rueckweg, die Session-Abfrage und das Abmelden.
 *
 * Dieser Pfad ist in Spec 1.3 als oeffentliche Ausnahme vorgesehen und steht
 * als Praefix in `PUBLIC_PREFIXES` des Forward-Auth-Endpunkts. Ohne diese
 * Ausnahme entstuende ein Kreis: der Login braeuchte eine Session.
 *
 * Die Instanz wird erst im Aufruf geholt (`getAuth()`), nicht beim Import:
 * `next build` wertet Route-Module aus, und dort gibt es keine Env.
 */

import { getAuth } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

function handle(request: Request): Promise<Response> {
  return getAuth().handler(request);
}

export const GET = handle;
export const POST = handle;
