/**
 * Verweise zwischen Apps fuer Menschen (ADR 0023 F): `GET /api/refs/resolve`,
 * `/api/refs/backlinks`, `/api/refs/actions` und `/api/people`. Getrennt von
 * den Routen, damit die Tests sie ohne Next pruefen. Agents haben dasselbe
 * als MCP-Tools `resolve_refs`, `list_backlinks`, `list_actions` und
 * `list_people`.
 *
 * Jeder Pfad ist auf zwei Wegen erreichbar, beide mit der Session aus dem
 * Cookie: auf dem Host der Control Plane unter `/api/…` und auf dem
 * gemeinsamen Host der Apps unter `/_platform/refs/…` bzw.
 * `/_platform/people` (Router `openapps-platform`, Rewrite in
 * `next.config.mjs`), wie die Suche aus ADR 0021. Alle nur lesend.
 *
 * Wer ruft, steht **nur** in der Session. `X-Auth-*` liest keine dieser
 * Routen: Auf dem Weg ueber Traefik hat die Strip-Middleware sie geloescht,
 * und auf jedem anderen Weg waeren sie nicht geprueft. Der Server einer App
 * ist nicht beteiligt; es gibt keinen Aufruf im Namen der Person von App zu
 * Plattform.
 */

import {
  listActions,
  listBacklinks,
  listPeople,
  resolveRefs,
  type App,
  type AppToolInvoker,
  type DomainContext,
  type RefCache,
} from '../domain';
import { PermissionDeniedError } from '../domain/errors';
import { currentUser } from './actor';
import { errorResponse, jsonResponse } from './http';
import { actorFromSession } from './session';

export interface RefsHttpOptions {
  /** Andere Adresse der Apps, im lokalen Betrieb der Ansehen-Proxy. */
  readonly appHref?: (app: App) => string | null;
}

async function sessionUser(request: Request) {
  const user = await currentUser(request);
  if (user === null) throw new PermissionDeniedError('no session');
  return user;
}

function correlationOf(request: Request): { correlationId?: string } {
  const id = request.headers.get('x-correlation-id');
  return id === null ? {} : { correlationId: id };
}

/** Verweise aus `?ref=a&ref=b` oder `?refs=a,b`. */
export function refsFromQuery(params: URLSearchParams): string[] {
  const listed = params.getAll('ref');
  const joined = params.getAll('refs').flatMap((value) => value.split(','));
  return [...listed, ...joined].map((ref) => ref.trim()).filter((ref) => ref !== '');
}

export async function handleResolveRefs(
  ctx: DomainContext,
  invoker: AppToolInvoker,
  request: Request,
  options: RefsHttpOptions & { readonly cache?: RefCache } = {},
): Promise<Response> {
  try {
    const user = await sessionUser(request);
    const refs = refsFromQuery(new URL(request.url).searchParams);
    const result = await resolveRefs(ctx, {
      actor: actorFromSession(user),
      humanIdentity: { userId: user.userId, email: user.email, groups: user.groups },
      refs,
      invoker,
      ...(options.cache === undefined ? {} : { cache: options.cache }),
      ...(options.appHref === undefined ? {} : { appHref: options.appHref }),
      ...correlationOf(request),
    });
    return noStore(jsonResponse(result));
  } catch (error) {
    return noStore(errorResponse(error));
  }
}

export async function handleBacklinks(ctx: DomainContext, request: Request): Promise<Response> {
  try {
    const user = await sessionUser(request);
    const result = await listBacklinks(ctx, {
      actor: actorFromSession(user),
      ref: new URL(request.url).searchParams.get('ref') ?? '',
      ...correlationOf(request),
    });
    return noStore(jsonResponse(result));
  } catch (error) {
    return noStore(errorResponse(error));
  }
}

export async function handleActions(
  ctx: DomainContext,
  request: Request,
  options: RefsHttpOptions = {},
): Promise<Response> {
  try {
    const user = await sessionUser(request);
    const params = new URL(request.url).searchParams;
    const result = await listActions(ctx, {
      actor: actorFromSession(user),
      ref: params.get('ref') ?? '',
      ...(params.get('excerpt') === null ? {} : { excerpt: params.get('excerpt') }),
      ...(options.appHref === undefined ? {} : { appHref: options.appHref }),
      ...correlationOf(request),
    });
    return noStore(jsonResponse(result));
  } catch (error) {
    return noStore(errorResponse(error));
  }
}

export async function handlePeople(ctx: DomainContext, request: Request): Promise<Response> {
  try {
    const user = await sessionUser(request);
    const params = new URL(request.url).searchParams;
    const limit = params.get('limit');
    const result = await listPeople(ctx, {
      actor: actorFromSession(user),
      app: params.get('app') ?? '',
      q: params.get('q') ?? '',
      ...(limit === null || limit === '' ? {} : { limit: Number(limit) }),
      ...correlationOf(request),
    });
    return noStore(jsonResponse(result));
  } catch (error) {
    return noStore(errorResponse(error));
  }
}

/** Pro Person; kein Proxy und kein Browser haelt die Antwort vor. */
function noStore(response: Response): Response {
  response.headers.set('cache-control', 'no-store');
  response.headers.set('x-content-type-options', 'nosniff');
  return response;
}
