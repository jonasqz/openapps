/**
 * Gruppenpflege als Domaenenfunktion — damit es sie als API und als MCP-Tool
 * geben kann (CLAUDE.md, Grundsatz 1).
 *
 * Vorher ging eine Mitgliedschaft nur per SQL oder ueber
 * `AUTH_BOOTSTRAP_ADMINS` beim ersten Login. Beides sind Wege um das
 * Rechtemodell herum: Der erste schreibt in die Tabelle, ohne dass jemand
 * `write` braucht, der zweite steht in der Env und wirkt bei jedem Login neu.
 *
 * Eine Gruppe ist seit Migration 0011 eine **Ressource** im selben Modell wie
 * eine App (Grundsatz 4 — ein Rechtemodell):
 *
 * | Recht                  | Was es erlaubt                                 |
 * | ---------------------- | ---------------------------------------------- |
 * | `read` auf `group:<n>` | die Mitglieder dieser Gruppe sehen             |
 * | `write` auf `group:<n>`| Mitglieder aufnehmen und entfernen             |
 * | `write` auf `group:*`  | zusaetzlich neue Gruppen anlegen               |
 *
 * `write` auf `group:*` ist noetig, um eine Gruppe **anzulegen**, und nicht
 * `write` auf ihren kuenftigen Namen: Vor dem Anlegen gibt es den Namen nicht,
 * eine Freigabe darauf koennte sich also jeder selbst ausstellen, der
 * irgendeine Gruppe pflegen darf.
 *
 * Was hier absichtlich **nicht** steht: eine Sperre dagegen, die letzte
 * Mitgliedschaft in `platform-admins` zu entfernen. Der Weg zurueck ist
 * `AUTH_BOOTSTRAP_ADMINS` plus ein Login — die Aussperrung ist also behebbar,
 * und eine Sonderregel fuer eine Gruppe waere eine Regel, die im Modell nicht
 * steht.
 */

import { audited } from './audit';
import { can, requirePermission } from './can';
import { ConflictError, NotFoundError, ValidationError } from './errors';
import { ANY } from './types';
import type { DomainContext } from './context';
import type { Actor, Group, GroupMember, ResourceRef } from './types';

/**
 * Dieselbe Form wie in Migration 0009 (`CHECK (name ~ ...)`). Sie steht hier
 * ein zweites Mal, damit ein falscher Name eine Fehlermeldung bekommt und
 * keinen Datenbankfehler — die Datenbank bleibt die Instanz, die es erzwingt.
 */
const GROUP_NAME = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;

/**
 * Und dieselbe Form wie der `CHECK` auf `group_members.email`. Kein Versuch,
 * E-Mail-Adressen vollstaendig zu validieren: Was hier zaehlt, ist, dass die
 * Adresse kein Komma enthaelt — der `X-Auth-Groups`-Header ist kommagetrennt,
 * und die Gruppennamen stehen darin.
 */
const MEMBER_EMAIL = /^[^@\s,]+@[^@\s,]+$/;

function groupResource(name: string): ResourceRef {
  return { kind: 'group', id: name };
}

function assertGroupName(name: string): string {
  if (!GROUP_NAME.test(name)) {
    throw new ValidationError(
      `"${name}" taugt nicht als Gruppenname: klein geschrieben, 3 bis 40 Zeichen, ` +
        'Buchstaben, Ziffern und Bindestriche, nicht am Rand',
    );
  }
  return name;
}

/** Kleingeschrieben, wie die Datenbank sie speichert (Migration 0009). */
function normalizeMemberEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!MEMBER_EMAIL.test(normalized)) {
    throw new ValidationError(`"${email}" ist keine brauchbare E-Mail-Adresse fuer eine Gruppe`);
  }
  return normalized;
}

async function requireGroup(ctx: DomainContext, name: string): Promise<Group> {
  const group = await ctx.groups.findByName(assertGroupName(name));
  if (group === null) throw new NotFoundError(`Gruppe "${name}" gibt es nicht`);
  return group;
}

/* -------------------------------------------------------------------------- */
/* Lesen                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Die Gruppen, die dieser Aufrufer sehen darf — gefiltert, nicht alles oder
 * nichts. Dasselbe Muster wie `listApps`: Wer `read` auf `group:*` hat, sieht
 * alle; wer es auf eine einzelne Gruppe hat, sieht diese.
 *
 * Eine Abfrage pro Gruppe. Bei der Groessenordnung, um die es geht (eine
 * Firma, Dutzende Gruppen), ist das der einfachere Weg; ein Filter in SQL
 * muesste die Wildcard-Semantik aus `grantMatches` ein zweites Mal
 * nachbauen.
 */
export async function listGroups(
  ctx: DomainContext,
  input: { actor: Actor; correlationId?: string },
): Promise<readonly Group[]> {
  const all = await ctx.groups.listAll();
  const visible: Group[] = [];
  for (const group of all) {
    if (await can(ctx, input.actor, 'read', groupResource(group.name))) visible.push(group);
  }

  await ctx.audit.append({
    occurredAt: ctx.clock.now(),
    actor: { kind: input.actor.kind, id: input.actor.id },
    action: 'list_groups',
    resource: groupResource(ANY),
    outcome: 'allowed',
    reason: null,
    detail: { visible: visible.length, total: all.length },
    correlationId: input.correlationId ?? null,
  });

  return visible;
}

export async function listGroupMembers(
  ctx: DomainContext,
  input: { actor: Actor; group: string; correlationId?: string },
): Promise<readonly GroupMember[]> {
  return audited(
    ctx,
    {
      actor: input.actor,
      action: 'list_group_members',
      resource: groupResource(input.group),
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    },
    async () => {
      const group = await requireGroup(ctx, input.group);
      await requirePermission(ctx, input.actor, 'read', groupResource(group.name));
      const members = await ctx.groups.listMembers(group.name);
      return { value: members, detail: { members: members.length } };
    },
  );
}

/* -------------------------------------------------------------------------- */
/* Schreiben                                                                   */
/* -------------------------------------------------------------------------- */

export async function createGroup(
  ctx: DomainContext,
  input: { actor: Actor; name: string; description?: string; correlationId?: string },
): Promise<Group> {
  return audited(
    ctx,
    {
      actor: input.actor,
      action: 'create_group',
      resource: groupResource(input.name),
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    },
    async () => {
      const name = assertGroupName(input.name);
      // Die Wildcard, nicht der eigene Name: siehe Dateikopf.
      await requirePermission(ctx, input.actor, 'write', groupResource(ANY));
      if ((await ctx.groups.findByName(name)) !== null) {
        throw new ConflictError(`Gruppe "${name}" gibt es schon`);
      }
      const group = await ctx.groups.create({ name, description: input.description ?? '' });
      return { value: group };
    },
  );
}

/**
 * Nimmt eine Adresse in eine Gruppe auf. Idempotent: War sie schon drin,
 * passiert nichts und `added` ist `false` — der Audit-Eintrag entsteht
 * trotzdem, weil der Versuch zum Verlauf gehoert.
 */
export async function addGroupMember(
  ctx: DomainContext,
  input: { actor: Actor; group: string; email: string; correlationId?: string },
): Promise<{ readonly group: string; readonly email: string; readonly added: boolean }> {
  return audited(
    ctx,
    {
      actor: input.actor,
      action: 'grant_group_member',
      resource: groupResource(input.group),
      // Roh, nicht normalisiert: Diese Zeile entsteht **vor** dem Rumpf. Wuerde
      // hier geprueft, haette eine unbrauchbare Adresse keinen Audit-Eintrag —
      // der Fehler flog, bevor `audited` ihn sehen kann.
      detail: { email: input.email },
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    },
    async () => {
      const email = normalizeMemberEmail(input.email);
      const group = await requireGroup(ctx, input.group);
      await requirePermission(ctx, input.actor, 'write', groupResource(group.name));

      const before = await ctx.groups.listMembers(group.name);
      const already = before.some((member) => member.email === email);
      if (!already) {
        await ctx.groups.ensureMembership(
          group.name,
          email,
          `${input.actor.kind}:${input.actor.id}`,
        );
      }
      return {
        value: { group: group.name, email, added: !already },
        detail: { added: !already },
      };
    },
  );
}

/**
 * Entfernt eine Adresse aus einer Gruppe. Wirkt sofort: `groupsFor` cacht
 * nicht, also verliert der naechste Aufruf der Forward-Auth jede Freigabe,
 * die an dieser Gruppe hing (DoD 3).
 */
export async function removeGroupMember(
  ctx: DomainContext,
  input: { actor: Actor; group: string; email: string; correlationId?: string },
): Promise<{ readonly group: string; readonly email: string; readonly removed: boolean }> {
  return audited(
    ctx,
    {
      actor: input.actor,
      action: 'revoke_group_member',
      resource: groupResource(input.group),
      // Roh, nicht normalisiert: Diese Zeile entsteht **vor** dem Rumpf. Wuerde
      // hier geprueft, haette eine unbrauchbare Adresse keinen Audit-Eintrag —
      // der Fehler flog, bevor `audited` ihn sehen kann.
      detail: { email: input.email },
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    },
    async () => {
      const email = normalizeMemberEmail(input.email);
      const group = await requireGroup(ctx, input.group);
      await requirePermission(ctx, input.actor, 'write', groupResource(group.name));

      const before = await ctx.groups.listMembers(group.name);
      const wasMember = before.some((member) => member.email === email);
      if (wasMember) await ctx.groups.removeMembership(group.name, email);
      return {
        value: { group: group.name, email, removed: wasMember },
        detail: { removed: wasMember },
      };
    },
  );
}
