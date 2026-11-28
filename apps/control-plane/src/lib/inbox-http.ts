/**
 * `GET /api/inbox` und `POST /api/inbox/mark` — der Eingang fuer Menschen
 * (ADR 0022 D). Getrennt von den Routen, damit die Tests sie ohne Next
 * pruefen. Agents haben dasselbe als MCP-Tools `list_inbox` und
 * `mark_inbox`.
 *
 * `GET` ist auf zwei Wegen erreichbar, beide mit der Session aus dem Cookie:
 * auf dem Host der Control Plane unter `/api/inbox` und auf dem gemeinsamen
 * Host der Apps unter `/_platform/inbox` (Router `openapps-platform`,
 * Rewrite in `next.config.mjs`), wie die Suche aus ADR 0021. `mark` nur auf
 * dem Host der Control Plane.
 *
 * Wer ruft, steht **nur** in der Session. `X-Auth-*` liest keine dieser
 * Routen: Auf dem Weg ueber Traefik hat die Strip-Middleware sie geloescht,
 * und auf jedem anderen Weg waeren sie nicht geprueft.
 */

import { listInbox, markInbox, type App, type DomainContext } from '../domain';
import { PermissionDeniedError } from '../domain/errors';
import { currentUser } from './actor';
import { errorResponse, jsonResponse, readJson } from './http';
import { actorFromSession } from './session';

export interface InboxHttpOptions {
  /** Andere Adresse der Apps, im lokalen Betrieb der Ansehen-Proxy. */
  readonly appHref?: (app: App) => string | null;
}

export async function handleInboxList(
  ctx: DomainContext,
  request: Request,
  options: InboxHttpOptions = {},
): Promise<Response> {
  try {
    const user = await currentUser(request);
    if (user === null) throw new PermissionDeniedError('no session');
    const params = new URL(request.url).searchParams;
    const limitParam = params.get('limit');
    const correlationId = request.headers.get('x-correlation-id') ?? undefined;
    const result = await listInbox(ctx, {
      actor: actorFromSession(user),
      email: user.email,
      ...(params.get('app') === null ? {} : { app: params.get('app') ?? '' }),
      ...(params.get('state') === null ? {} : { state: params.get('state') ?? '' }),
      ...(limitParam === null || limitParam === '' ? {} : { limit: Number(limitParam) }),
      ...(options.appHref === undefined ? {} : { appHref: options.appHref }),
      ...(correlationId === undefined ? {} : { correlationId }),
    });
    return noStore(jsonResponse(result));
  } catch (error) {
    return noStore(errorResponse(error));
  }
}

/**
 * Eine schreibende Anfrage aus dem Browser traegt `Origin`. Kommt sie von
 * einem anderen Host als der Control Plane (etwa aus einer App auf dem
 * gemeinsamen Host), wird sie abgewiesen. Ohne `Origin` (kein Browser) zaehlt
 * nur die Session.
 */
export function sameOriginWrite(request: Request, controlPlaneHost: string): boolean {
  const origin = request.headers.get('origin');
  if (origin === null) return true;
  try {
    return new URL(origin).hostname.toLowerCase() === controlPlaneHost.toLowerCase();
  } catch {
    return false;
  }
}

export async function handleInboxMark(
  ctx: DomainContext,
  request: Request,
  options: { readonly controlPlaneHost: string },
): Promise<Response> {
  try {
    if (!sameOriginWrite(request, options.controlPlaneHost)) {
      throw new PermissionDeniedError('write request from another origin');
    }
    const user = await currentUser(request);
    if (user === null) throw new PermissionDeniedError('no session');
    const body = await readJson<{ ids?: unknown; state?: unknown }>(request);
    const correlationId = request.headers.get('x-correlation-id') ?? undefined;
    const result = await markInbox(ctx, {
      actor: actorFromSession(user),
      email: user.email,
      ids: body?.ids,
      state: body?.state,
      ...(correlationId === undefined ? {} : { correlationId }),
    });
    return noStore(jsonResponse(result));
  } catch (error) {
    return noStore(errorResponse(error));
  }
}

/** Der Eingang ist pro Person; kein Proxy und kein Browser haelt ihn vor. */
function noStore(response: Response): Response {
  response.headers.set('cache-control', 'no-store');
  response.headers.set('x-content-type-options', 'nosniff');
  return response;
}
