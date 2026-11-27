/**
 * Wer bin ich auf der Plattform? Das Gegenstueck zur Seite `/settings`, zu
 * `GET /api/me` und zum MCP-Tool `whoami` (ADR 0017, CLAUDE.md Grundsatz 1).
 *
 * Hier entsteht keine neue Rechtelogik. Alles kommt aus den Funktionen, die
 * dieselbe Frage schon an anderer Stelle beantworten:
 *
 * - die Apps aus `visibleAppsFor` — dieselbe Liste wie in der Leiste,
 * - `canCreateApps` und `isPlatformAdmin` aus `navigation.ts`,
 * - die Freigaben ueber `subjectsOf` — dieselben Subjekte, die `can` fuer
 *   diesen Aufrufer prueft: er selbst plus seine Gruppen. Mehr nicht, also
 *   sieht niemand die Freigaben eines anderen oder einer fremden Gruppe.
 *
 * Der eine Audit-Eintrag pro Aufruf heisst `whoami`, wie das MCP-Tool — auch
 * wenn der Aufruf von `GET /api/me` oder der Seite kommt. Die Aktion ist in
 * `audit_log.action` freier Text (Migration 0004), braucht also keine
 * Migration.
 *
 * `isAdmin` ist Anzeige, keine Freigabe: Was jemand darf, entscheidet weiter
 * `can` bei jedem einzelnen Aufruf.
 */

import type { PlatformNavApp } from '@openapps/sdk';
import type { DomainContext } from './context';
import { audited } from './audit';
import { subjectsOf } from './can';
import { canCreateApps, isPlatformAdmin, visibleAppsFor } from './navigation';
import type { Actor, Grant, SubjectKind, SubjectRef } from './types';

/** Woher ein Recht kommt: direkt auf den Aufrufer oder ueber eine seiner Gruppen. */
export type GrantSource =
  | { readonly kind: 'direct' }
  | { readonly kind: 'group'; readonly group: string };

/** Eine Freigabe, wie sie in der eigenen Sicht steht: mit Herkunft. */
export interface ActorGrant extends Grant {
  readonly via: GrantSource;
}

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
   * Alle offenen Freigaben, die fuer diesen Aufrufer wirken: direkte zuerst,
   * dann je Gruppe in der Reihenfolge von `groups`. Jede Zeile steht einzeln
   * da, auch wenn dasselbe Recht direkt und ueber eine Gruppe kommt — sonst
   * waere nicht zu sehen, dass ein Widerruf an einer Stelle nicht reicht.
   * Widerrufene Freigaben fehlen: Sie sind kein Zugang mehr.
   */
  readonly grants: readonly ActorGrant[];
  /** Nur bei `kind: 'agent'`; sonst `null`. */
  readonly agent: AgentSelf | null;
}

export async function describeActor(
  ctx: DomainContext,
  actor: Actor,
  options: { readonly email?: string | null; readonly correlationId?: string } = {},
): Promise<ActorDescription> {
  return audited(
    ctx,
    {
      actor,
      action: 'whoami',
      // Keine Ressource: Gefragt wird nach dem Aufrufer selbst, und der steht
      // schon in `actor_kind`/`actor_id`. Fuer einen Menschen gaebe es ohnehin
      // keine passende `grant_resource_kind`.
      resource: null,
      ...(options.correlationId === undefined ? {} : { correlationId: options.correlationId }),
    },
    async () => {
      const groups = uniqueGroups(actor);
      const grants = await ownGrants(ctx, { ...actor, groups });
      const apps = await visibleAppsFor(ctx, actor);
      const mayCreate = await canCreateApps(ctx, actor);
      const agent = actor.kind === 'agent' ? await agentSelf(ctx, actor.id) : null;

      const direct = grants.filter((g) => g.via.kind === 'direct').length;
      return {
        value: {
          kind: actor.kind,
          id: actor.id,
          email: actor.kind === 'user' ? (options.email ?? null) : null,
          groups,
          isAdmin: isPlatformAdmin(actor),
          canCreateApps: mayCreate,
          apps,
          grants,
          agent,
        },
        // Nur Zahlen, keine Ids: Das Log soll zeigen, dass nachgesehen wurde,
        // nicht die Rechte ein zweites Mal ablegen.
        detail: {
          grants: grants.length,
          direct,
          viaGroup: grants.length - direct,
          apps: apps.length,
        },
      };
    },
  );
}

/** Die Gruppen des Aufrufers, jede einmal, in der Reihenfolge der Anmeldung. */
function uniqueGroups(actor: Actor): readonly string[] {
  return [...new Set(actor.groups ?? [])];
}

/**
 * Die offenen Freigaben auf genau die Subjekte, die `can` fuer diesen
 * Aufrufer heranzieht. Keine Rechtepruefung davor: Die eigenen Freigaben
 * darf jeder sehen (wie `listGrants` mit dem eigenen Subjekt), und eine
 * fremde kann hier nicht hineingeraten, weil nur nach eigenen Subjekten
 * gefragt wird.
 */
async function ownGrants(ctx: DomainContext, actor: Actor): Promise<readonly ActorGrant[]> {
  const subjects = subjectsOf(actor);
  const rows = await ctx.grants.listForSubjects(subjects);

  // Sortiert nach der Reihenfolge der Subjekte: direkt, dann Gruppe fuer
  // Gruppe. Innerhalb eines Subjekts bleibt die Reihenfolge des Speichers.
  const rank = (subject: SubjectRef): number =>
    subjects.findIndex((s) => s.kind === subject.kind && s.id === subject.id);

  const seen = new Set<string>();
  const result: { readonly grant: ActorGrant; readonly rank: number }[] = [];
  for (const row of rows) {
    if (row.revokedAt !== null) continue;
    // Zweite Absicherung: Der Speicher soll nur eigene Subjekte liefern. Tut
    // er es nicht, faellt die Zeile hier heraus, statt angezeigt zu werden.
    const position = rank(row.subject);
    if (position < 0) continue;
    // Eine Zeile ist eine Freigabe; doppelt kann sie nur durch den Speicher
    // kommen. Verschiedene Zeilen mit gleichem Recht bleiben alle stehen.
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    const via: GrantSource =
      row.subject.kind === 'group' ? { kind: 'group', group: row.subject.id } : { kind: 'direct' };
    result.push({ grant: { ...row, via }, rank: position });
  }
  // `sort` ist stabil (ES2019), die Speicher-Reihenfolge je Subjekt bleibt.
  return result.sort((a, b) => a.rank - b.rank).map((entry) => entry.grant);
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
