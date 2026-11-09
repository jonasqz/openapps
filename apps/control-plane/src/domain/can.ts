/**
 * Die eine Rechtepruefung. Alles, was Rechte prueft — HTTP-Routen,
 * MCP-Tools, Forward-Auth —, geht hier durch.
 *
 * Zwei Regeln, die nicht verhandelbar sind:
 *
 * 1. **Default-Deny.** Ohne passende, nicht widerrufene Freigabe ist die
 *    Antwort `false`. Es gibt keinen Zweig, der ohne Freigabe `true` liefert.
 * 2. **Kein Cache.** Jeder Aufruf fragt den Speicher. Ein Widerruf wirkt
 *    deshalb beim naechsten Aufruf, nicht nach Ablauf einer Frist (DoD 3).
 *    Wer hier memoisiert, bricht das Kriterium.
 */

import { PermissionDeniedError } from './errors';
import type { DomainContext } from './context';
import type { Actor, ResourceRef, SubjectRef, Verb } from './types';

/**
 * Das Subjekt selbst plus eine Gruppen-Zeile pro Gruppe. Eine Freigabe an eine
 * Gruppe wirkt damit fuer jedes Mitglied, ohne sie zu kopieren.
 */
export function subjectsOf(actor: Actor): readonly SubjectRef[] {
  const self: SubjectRef = { kind: actor.kind, id: actor.id };
  const groups = (actor.groups ?? []).map((id): SubjectRef => ({ kind: 'group', id }));
  return [self, ...groups];
}

export async function can(
  ctx: DomainContext,
  actor: Actor,
  verb: Verb,
  resource: ResourceRef,
): Promise<boolean> {
  const matches = await ctx.grants.findActive({
    subjects: subjectsOf(actor),
    verb,
    resource,
  });
  return matches.length > 0;
}

/** Wie `can`, wirft aber. Fuer Aufrufpfade, die ohne Recht nicht weiterlaufen. */
export async function requirePermission(
  ctx: DomainContext,
  actor: Actor,
  verb: Verb,
  resource: ResourceRef,
): Promise<void> {
  if (!(await can(ctx, actor, verb, resource))) {
    throw new PermissionDeniedError(
      `${actor.kind}:${actor.id} darf nicht ${verb} auf ${resource.kind}:${resource.id}`,
    );
  }
}

/**
 * Passt eine gespeicherte Freigabe auf eine Anfrage? Wird von jeder
 * Repository-Implementierung benutzt, damit In-Memory und SQL dieselbe
 * Semantik haben (Wildcard '*' auf der Ressourcen-Id).
 */
export function grantMatches(
  grant: { subject: SubjectRef; verb: Verb; resource: ResourceRef; revokedAt: Date | null },
  lookup: { subjects: readonly SubjectRef[]; verb: Verb; resource: ResourceRef },
): boolean {
  if (grant.revokedAt !== null) return false;
  if (grant.verb !== lookup.verb) return false;
  if (grant.resource.kind !== lookup.resource.kind) return false;
  if (grant.resource.id !== '*' && grant.resource.id !== lookup.resource.id) return false;
  return lookup.subjects.some((s) => s.kind === grant.subject.kind && s.id === grant.subject.id);
}
