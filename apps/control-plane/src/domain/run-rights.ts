/**
 * Die Rechte eines Laufs (ADR 0024 E und C2):
 *
 * **Wirksame Rechte = Freigaben des Agenten geschnitten mit denen des
 * Ausloesers**, und bei externem Chat-Anbieter ohne die Apps aus
 * `OPENAPPS_MODEL_LOCAL_ONLY_APPS`.
 *
 * Durchgesetzt an genau einer Stelle: `findActive` der Freigaben im Kontext
 * des Laufs. Jede Rechtepruefung der Domaene (`can`, `canAccessApp`,
 * `listAppTools`, `callAppTool`, die Suche, die Verweise, das Gedaechtnis)
 * geht dort durch. Fragt sie nach dem Agenten, gilt eine Freigabe nur, wenn
 *
 * 1. der Agent sie hat (wie ueber `/mcp`),
 * 2. die Ressource keine gesperrte App betrifft, und
 * 3. der Ausloeser dasselbe darf, gelesen bei **jeder** Pruefung, ohne Cache.
 *
 * Was „dasselbe“ fuer einen Menschen heisst: Menschen haben keine
 * `execute`-Freigaben auf App-Tools; sie arbeiten in einer App, sobald sie
 * `read` auf die App haben (Forward-Auth). Ein App-Tool `<app>.<tool>` deckt
 * ein Mensch deshalb mit `read` auf die App, ein Agent als Ausloeser mit
 * derselben Freigabe. Alles andere (Apps, Gruppen, Agents, Plattform-Tools)
 * prueft dieselbe Freigabe beim Ausloeser. Ausnahme: das Gedaechtnis
 * (`platform.remember`, `platform.recall`) braucht nur der Agent; was ein
 * Lauf darin sieht, begrenzt die Herkunft jedes Eintrags, und die pruefen
 * dieselben geschnittenen Rechte.
 *
 * Fragen nach anderen Subjekten (etwa Empfaengern einer Benachrichtigung)
 * gehen unveraendert durch: Der Schnitt gilt fuer den Lauf, nicht fuer die
 * Plattform.
 */

import { subjectsCanAccessApp } from './apps';
import { canSubjects } from './can';
import type { DomainContext } from './context';
import { PLATFORM_AGENT_TOOLS, PLATFORM_TARGET } from './events';
import type { AgentRunTrigger, GrantLookup, GrantRepository } from './ports';
import type { App, ResourceRef, SubjectRef, Verb } from './types';

export interface RunRights {
  readonly agentName: string;
  /** `null`: ausgeloest von der Plattform fuer eine App; dann gelten die Freigaben des Agenten allein. */
  readonly trigger: AgentRunTrigger | null;
  /** Apps, die der Lauf nicht sehen darf (lokal-only bei externem Anbieter). */
  readonly blockedApps: ReadonlySet<string>;
}

async function appOf(ctx: DomainContext, id: string): Promise<App | null> {
  const app = (await ctx.apps.findByName(id)) ?? (await ctx.apps.findById(id));
  return app === null || app.archivedAt !== null ? null : app;
}

/** Die App, zu der eine Ressource gehoert, oder `null` (Gruppe, Agent, Wildcard, Plattform). */
async function owningAppName(ctx: DomainContext, resource: ResourceRef): Promise<string | null> {
  if (resource.id === '*') return null;
  if (resource.kind === 'app') return (await appOf(ctx, resource.id))?.name ?? resource.id;
  if (resource.kind === 'tool' || resource.kind === 'table' || resource.kind === 'view') {
    const separator = resource.id.indexOf('.');
    return separator <= 0 ? null : resource.id.slice(0, separator);
  }
  return null;
}

/** Subjekte des Ausloesers, frisch gelesen: Nutzer-Id und Gruppen seiner E-Mail. */
export async function triggerSubjects(
  ctx: DomainContext,
  trigger: AgentRunTrigger,
): Promise<SubjectRef[]> {
  if (trigger.kind === 'agent') {
    const identity = await ctx.agents.findByName(trigger.id);
    if (identity === null || identity.disabledAt !== null) return [];
    return [{ kind: 'agent', id: trigger.id }];
  }
  const subjects: SubjectRef[] = [{ kind: 'user', id: trigger.id }];
  if (trigger.email !== null && trigger.email !== '') {
    for (const group of await ctx.groups.groupsFor(trigger.email)) {
      subjects.push({ kind: 'group', id: group });
    }
  }
  return subjects;
}

/** Darf der Ausloeser, was der Agent hier tun soll? `base` ist der Kontext ohne Schnitt. */
async function triggerCovers(
  base: DomainContext,
  trigger: AgentRunTrigger,
  verb: Verb,
  resource: ResourceRef,
): Promise<boolean> {
  const subjects = await triggerSubjects(base, trigger);
  if (subjects.length === 0) return false;

  if (resource.kind === 'app' && resource.id !== '*') {
    const app = await appOf(base, resource.id);
    return app !== null && subjectsCanAccessApp(base, subjects, verb, app);
  }

  if (resource.kind === 'tool' || resource.kind === 'table' || resource.kind === 'view') {
    const separator = resource.id.indexOf('.');
    const appName = separator <= 0 ? '' : resource.id.slice(0, separator);
    const object = separator <= 0 ? '' : resource.id.slice(separator + 1);
    if (appName === PLATFORM_TARGET) {
      if (resource.kind === 'tool' && PLATFORM_AGENT_TOOLS.includes(object)) return true;
      return canSubjects(base, subjects, verb, resource);
    }
    if (trigger.kind === 'user') {
      const app = await appOf(base, appName);
      return app !== null && subjectsCanAccessApp(base, subjects, 'read', app);
    }
  }

  return canSubjects(base, subjects, verb, resource);
}

function asksAgent(lookup: GrantLookup, agentName: string): boolean {
  return lookup.subjects.some((subject) => subject.kind === 'agent' && subject.id === agentName);
}

/** Die Freigaben im Kontext eines Laufs. */
export function intersectedGrants(base: DomainContext, rights: RunRights): GrantRepository {
  const grants = base.grants;
  return {
    insert: (grant) => grants.insert(grant),
    findActiveById: (id) => grants.findActiveById(id),
    findActiveMatching: (match) => grants.findActiveMatching(match),
    revoke: (id, by, at) => grants.revoke(id, by, at),
    listForSubjects: (subjects) => grants.listForSubjects(subjects),
    listForResource: (resource) => grants.listForResource(resource),
    listAll: (limit) => grants.listAll(limit),

    async findActive(lookup) {
      const matches = await grants.findActive(lookup);
      if (matches.length === 0 || !asksAgent(lookup, rights.agentName)) return matches;
      if (rights.blockedApps.size > 0) {
        const owner = await owningAppName(base, lookup.resource);
        if (owner !== null && rights.blockedApps.has(owner)) return [];
      }
      if (rights.trigger === null) return matches;
      return (await triggerCovers(base, rights.trigger, lookup.verb, lookup.resource))
        ? matches
        : [];
    },
  };
}

/** Der Kontext, in dem ein Lauf alles tut. Nur die Freigaben sind anders. */
export function runContext(base: DomainContext, rights: RunRights): DomainContext {
  return { ...base, grants: intersectedGrants(base, rights) };
}
