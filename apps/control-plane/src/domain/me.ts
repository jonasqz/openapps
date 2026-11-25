/**
 * Wer bin ich auf der Plattform? Das Gegenstueck zur Seite `/settings`, zu
 * `GET /api/me` und zum MCP-Tool `whoami` (ADR 0017, CLAUDE.md Grundsatz 1).
 *
 * Hier entsteht keine neue Rechtelogik. Alles kommt aus den Funktionen, die
 * dieselbe Frage schon an anderer Stelle beantworten:
 *
 * - die Apps aus `visibleAppsFor` — dieselbe Liste wie in der Leiste,
 * - `canCreateApps` und `isPlatformAdmin` aus `navigation.ts`,
 * - die Freigaben aus `listGrants` mit dem eigenen Subjekt. Das darf jeder,
 *   ohne weiteres Recht, und `listGrants` schreibt den einen Audit-Eintrag.
 *
 * `isAdmin` ist Anzeige, keine Freigabe: Was jemand darf, entscheidet weiter
 * `can` bei jedem einzelnen Aufruf.
 */

import type { PlatformNavApp } from '@openapps/sdk';
import type { DomainContext } from './context';
import { listGrants } from './grants';
import { canCreateApps, isPlatformAdmin, visibleAppsFor } from './navigation';
import type { Actor, Grant, SubjectKind } from './types';

/** Was ueber eine Agent-Identitaet ohnehin in der eigenen Zeile steht. */
export interface AgentSelf {
  readonly name: string;
  readonly displayName: string;
  readonly ownerUserId: string;
  readonly createdAt: Date;
  readonly lastSeenAt: Date | null;
}

export interface ActorDescription {
  readonly kind: SubjectKind;
  readonly id: string;
  /** Nur bei Menschen, aus der Anmeldung. Agents haben keine Adresse. */
  readonly email: string | null;
  readonly groups: readonly string[];
  readonly isAdmin: boolean;
  readonly canCreateApps: boolean;
  readonly apps: readonly PlatformNavApp[];
  /**
   * Die Freigaben, die direkt auf dieses Subjekt laufen. Freigaben ueber eine
   * Gruppe stehen bei der Gruppe, nicht hier.
   */
  readonly grants: readonly Grant[];
  /** Nur bei `kind: 'agent'`; sonst `null`. */
  readonly agent: AgentSelf | null;
}

export async function describeActor(
  ctx: DomainContext,
  actor: Actor,
  options: { readonly email?: string | null; readonly correlationId?: string } = {},
): Promise<ActorDescription> {
  const grants = await listGrants(ctx, {
    actor,
    subject: { kind: actor.kind, id: actor.id },
    ...(options.correlationId === undefined ? {} : { correlationId: options.correlationId }),
  });
  const apps = await visibleAppsFor(ctx, actor);
  const mayCreate = await canCreateApps(ctx, actor);
  const agent = actor.kind === 'agent' ? await agentSelf(ctx, actor.id) : null;

  return {
    kind: actor.kind,
    id: actor.id,
    email: actor.kind === 'user' ? (options.email ?? null) : null,
    groups: [...(actor.groups ?? [])],
    isAdmin: isPlatformAdmin(actor),
    canCreateApps: mayCreate,
    apps,
    grants,
    agent,
  };
}

/**
 * Die eigene Zeile, ohne Client-Id und ohne Hash. Ein gesperrter Agent kommt
 * gar nicht erst herein; fehlt die Zeile trotzdem, bleibt es bei `null`.
 */
async function agentSelf(ctx: DomainContext, name: string): Promise<AgentSelf | null> {
  const identity = await ctx.agents.findByName(name);
  if (identity === null) return null;
  return {
    name: identity.name,
    displayName: identity.displayName,
    ownerUserId: identity.ownerUserId,
    createdAt: identity.createdAt,
    lastSeenAt: identity.lastSeenAt,
  };
}
