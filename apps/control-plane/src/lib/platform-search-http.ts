/**
 * `GET /api/search?q=…&apps=crm,wiki&limit=5` — die Suche ueber alle Apps
 * fuer Menschen (ADR 0021). Getrennt von der Route, damit die Tests sie ohne
 * Next pruefen. Agents haben dasselbe als MCP-Tool `search`.
 *
 * Erreichbar auf zwei Wegen, beide mit der Session aus dem Cookie:
 *
 * - auf dem Host der Control Plane unter `/api/search`;
 * - auf dem gemeinsamen Host der Apps unter `/_platform/search`. Dafuer gibt
 *   es einen eigenen Router (`openapps-platform`) mit denselben zwei
 *   Middlewares wie jede App, und Next schreibt den Pfad auf diese Route um
 *   (`next.config.mjs`). So ruft die Leiste im Browser die Suche auf ihrem
 *   eigenen Origin, ohne CORS und ohne zweites Cookie.
 *
 * Wer ruft, steht **nur** in der Session. `X-Auth-*` liest diese Route nicht:
 * Auf dem Weg ueber Traefik hat die Strip-Middleware sie geloescht, und auf
 * jedem anderen Weg waeren sie ohnehin nicht geprueft.
 */

import {
  searchApps,
  type AppToolInvoker,
  type DomainContext,
  type SearchAppsInput,
} from '../domain';
import { PermissionDeniedError } from '../domain/errors';
import { currentUser } from './actor';
import { errorResponse } from './http';
import { actorFromSession } from './session';

export async function handlePlatformSearch(
  ctx: DomainContext,
  invoker: AppToolInvoker,
  request: Request,
  options: { readonly appHref?: SearchAppsInput['appHref'] } = {},
): Promise<Response> {
  try {
    const user = await currentUser(request);
    if (user === null) throw new PermissionDeniedError('no session');

    const params = new URL(request.url).searchParams;
    const appsParam = params.getAll('apps').flatMap((value) => value.split(','));
    const apps = appsParam.map((name) => name.trim()).filter((name) => name !== '');
    const limitParam = params.get('limit');
    const limit = limitParam === null || limitParam === '' ? undefined : Number(limitParam);
    const correlationId = request.headers.get('x-correlation-id') ?? undefined;

    const result = await searchApps(ctx, {
      actor: actorFromSession(user),
      humanIdentity: { userId: user.userId, email: user.email, groups: user.groups },
      query: params.get('q') ?? '',
      ...(apps.length === 0 ? {} : { apps }),
      ...(limit === undefined ? {} : { limit }),
      invoker,
      ...(correlationId === undefined ? {} : { correlationId }),
      ...(options.appHref === undefined ? {} : { appHref: options.appHref }),
    });
    return noStore(Response.json(result));
  } catch (error) {
    return noStore(errorResponse(error));
  }
}

/** Suchergebnisse sind pro Person; kein Proxy und kein Browser haelt sie vor. */
function noStore(response: Response): Response {
  response.headers.set('cache-control', 'no-store');
  response.headers.set('x-content-type-options', 'nosniff');
  return response;
}
