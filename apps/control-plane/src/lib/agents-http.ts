/**
 * HTTP fuer Plattform-Agents, Gedaechtnis und Zusammenfassung (ADR 0024),
 * fuer Menschen mit Session. Agents haben dasselbe als MCP-Tools
 * (`configure_agent`, `list_agent_profiles`, `start_agent_run`,
 * `get_agent_run`, `list_agent_runs`, `recall`, `list_memories`, `forget`).
 * Getrennt von den Routen, damit die Tests sie ohne Next pruefen.
 *
 * Wer ruft, steht **nur** in der Session. Schreibende Anfragen aus dem
 * Browser muessen vom Host der Control Plane kommen (`Origin`).
 */

import {
  configureAgent,
  forget,
  getAgentRun,
  listAgentProfiles,
  listAgentRuns,
  listMemories,
  recall,
  startAgentRun,
  summarizeInbox,
  type DomainContext,
} from '../domain';
import { PermissionDeniedError } from '../domain/errors';
import { currentUser } from './actor';
import { errorResponse, jsonResponse, readJson } from './http';
import { sameOriginWrite } from './inbox-http';
import { actorFromSession } from './session';

export interface WriteOptions {
  readonly controlPlaneHost: string;
}

function noStore(response: Response): Response {
  response.headers.set('cache-control', 'no-store');
  response.headers.set('x-content-type-options', 'nosniff');
  return response;
}

async function sessionOf(request: Request) {
  const user = await currentUser(request);
  if (user === null) throw new PermissionDeniedError('no session');
  return { user, actor: actorFromSession(user) };
}

function correlationOf(request: Request): { correlationId?: string } {
  const id = request.headers.get('x-correlation-id');
  return id === null ? {} : { correlationId: id };
}

async function handle(work: () => Promise<Response>): Promise<Response> {
  try {
    return noStore(await work());
  } catch (error) {
    return noStore(errorResponse(error));
  }
}

function assertSameOrigin(request: Request, options: WriteOptions): void {
  if (!sameOriginWrite(request, options.controlPlaneHost)) {
    throw new PermissionDeniedError('write request from another origin');
  }
}

/** `GET /api/agent-profiles` */
export function handleListAgentProfiles(ctx: DomainContext, request: Request): Promise<Response> {
  return handle(async () => {
    const { actor } = await sessionOf(request);
    return jsonResponse(await listAgentProfiles(ctx, { actor, ...correlationOf(request) }));
  });
}

/** `PUT /api/agents/:agent/profile` */
export function handleConfigureAgent(
  ctx: DomainContext,
  request: Request,
  agent: string,
  options: WriteOptions,
): Promise<Response> {
  return handle(async () => {
    assertSameOrigin(request, options);
    const { actor } = await sessionOf(request);
    const body = await readJson<Record<string, unknown> | null>(request);
    const profile = await configureAgent(ctx, {
      actor,
      name: agent,
      instructions: body?.instructions,
      model: body?.model,
      maxSteps: body?.maxSteps,
      tokenBudget: body?.tokenBudget,
      ...correlationOf(request),
    });
    return jsonResponse({ profile });
  });
}

/** `GET /api/agent-runs` */
export function handleListAgentRuns(ctx: DomainContext, request: Request): Promise<Response> {
  return handle(async () => {
    const { actor } = await sessionOf(request);
    const params = new URL(request.url).searchParams;
    const limit = params.get('limit');
    return jsonResponse(
      await listAgentRuns(ctx, {
        actor,
        ...(params.get('agent') === null ? {} : { agent: params.get('agent') }),
        ...(limit === null || limit === '' ? {} : { limit: Number(limit) }),
        ...correlationOf(request),
      }),
    );
  });
}

/** `POST /api/agent-runs` */
export function handleStartAgentRun(
  ctx: DomainContext,
  request: Request,
  options: WriteOptions,
): Promise<Response> {
  return handle(async () => {
    assertSameOrigin(request, options);
    const { user, actor } = await sessionOf(request);
    const body = await readJson<Record<string, unknown> | null>(request);
    const run = await startAgentRun(ctx, {
      actor,
      email: user.email,
      agent: body?.agent,
      prompt: body?.prompt,
      ...correlationOf(request),
    });
    return jsonResponse({ run }, 202);
  });
}

/** `GET /api/agent-runs/:run` */
export function handleGetAgentRun(
  ctx: DomainContext,
  request: Request,
  id: string,
): Promise<Response> {
  return handle(async () => {
    const { actor } = await sessionOf(request);
    return jsonResponse({ run: await getAgentRun(ctx, { actor, id, ...correlationOf(request) }) });
  });
}

/** `POST /api/inbox/summary` */
export function handleInboxSummary(
  ctx: DomainContext,
  request: Request,
  options: WriteOptions,
): Promise<Response> {
  return handle(async () => {
    assertSameOrigin(request, options);
    const { user, actor } = await sessionOf(request);
    return jsonResponse(
      await summarizeInbox(ctx, { actor, email: user.email, ...correlationOf(request) }),
    );
  });
}

/** `GET /api/memories?q=…` (recall) oder `?agent=…` (list_memories). */
export function handleMemories(ctx: DomainContext, request: Request): Promise<Response> {
  return handle(async () => {
    const { actor } = await sessionOf(request);
    const params = new URL(request.url).searchParams;
    const limit = params.get('limit');
    const limitOption = limit === null || limit === '' ? {} : { limit: Number(limit) };
    const query = params.get('q');
    if (query !== null && query !== '') {
      return jsonResponse(
        await recall(ctx, { actor, query, ...limitOption, ...correlationOf(request) }),
      );
    }
    return jsonResponse(
      await listMemories(ctx, {
        actor,
        ...(params.get('agent') === null ? {} : { agent: params.get('agent') }),
        ...limitOption,
        ...correlationOf(request),
      }),
    );
  });
}

/** `DELETE /api/memories/:memory` */
export function handleForget(
  ctx: DomainContext,
  request: Request,
  id: string,
  options: WriteOptions,
): Promise<Response> {
  return handle(async () => {
    assertSameOrigin(request, options);
    const { actor } = await sessionOf(request);
    return jsonResponse(await forget(ctx, { actor, id, ...correlationOf(request) }));
  });
}
