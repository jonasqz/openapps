/**
 * Freigeben und widerrufen — der Kern von DoD 3.
 *
 * Zwei Dinge passieren hier zusammen:
 *
 * 1. Die Freigabe wird als Zeile in `grants` gefuehrt. Das ist das Rechtemodell,
 *    gegen das `can` prueft, und es gilt fuer Mensch, Gruppe, App und Agent.
 * 2. Ist das Subjekt eine App und die Ressource eine Tabelle oder View, wird die
 *    Freigabe zusaetzlich in Postgres gesetzt. Nur so sieht App A wirklich
 *    nichts von App B, auch wenn A sich falsch verhaelt.
 *
 * Wer freigeben will, braucht selbst `write` auf die Ressource. Man kann nur
 * weitergeben, was man selbst aendern darf.
 */

import { audited } from './audit';
import { requireAppPermission } from './apps';
import { can, requirePermission } from './can';
import { ConflictError, NotFoundError } from './errors';
import { parseObjectResourceId } from './naming';
import type { DomainContext } from './context';
import type { Actor, Grant, ResourceRef, SubjectRef, Verb } from './types';

/**
 * Wer darf eine Freigabe auf diese Ressource vergeben oder widerrufen?
 *
 * Eine Tabelle, eine View und ein Tool gehoeren immer zu einer App — ihre
 * Ressourcen-Id beginnt mit dem App-Namen. Wer `write` auf die App hat,
 * entscheidet deshalb auch ueber ihre Objekte. Das haelt das Modell bei einem
 * Verb pro Ressourcenart und verhindert, dass die Wildcard '*' wandern muss.
 */
async function requireAuthorityOver(
  ctx: DomainContext,
  actor: Actor,
  resource: ResourceRef,
  verb: Verb,
): Promise<void> {
  if (resource.kind === 'app') {
    if (resource.id === '*') {
      await requirePermission(ctx, actor, verb, resource);
      return;
    }
    const app = (await ctx.apps.findById(resource.id)) ?? (await ctx.apps.findByName(resource.id));
    if (app === null) throw new NotFoundError(`App "${resource.id}" gibt es nicht`);
    await requireAppPermission(ctx, actor, verb, app);
    return;
  }

  const { appName } = parseObjectResourceId(resource.id);
  const owner = await ctx.apps.findByName(appName);
  if (owner === null) throw new NotFoundError(`App "${appName}" gibt es nicht`);
  await requireAppPermission(ctx, actor, verb, owner);
}

export interface GrantInput {
  readonly actor: Actor;
  readonly subject: SubjectRef;
  readonly verb: Verb;
  readonly resource: ResourceRef;
  readonly correlationId?: string;
}

export async function grant(ctx: DomainContext, input: GrantInput): Promise<Grant> {
  return audited(
    ctx,
    {
      actor: input.actor,
      action: 'grant',
      resource: input.resource,
      detail: {
        subject: `${input.subject.kind}:${input.subject.id}`,
        verb: input.verb,
      },
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    },
    async () => {
      await requireAuthorityOver(ctx, input.actor, input.resource, 'write');

      const existing = await ctx.grants.findActiveMatching({
        subject: input.subject,
        verb: input.verb,
        resource: input.resource,
      });
      if (existing !== null) {
        throw new ConflictError('diese Freigabe gibt es schon');
      }

      const created = await ctx.grants.insert({
        subject: input.subject,
        verb: input.verb,
        resource: input.resource,
        grantedBy: `${input.actor.kind}:${input.actor.id}`,
      });

      await syncDatabaseGrant(ctx, created, 'grant');

      return { value: created, detail: { grantId: created.id } };
    },
  );
}

export interface RevokeInput {
  readonly actor: Actor;
  readonly grantId: string;
  readonly correlationId?: string;
}

/**
 * Widerruf wirkt sofort: die Zeile wird als widerrufen markiert (nicht
 * geloescht), und bei Tabellen und Views folgt ein REVOKE in Postgres. Es gibt
 * keinen Cache, der danach noch "erlaubt" sagt.
 */
export async function revoke(ctx: DomainContext, input: RevokeInput): Promise<Grant> {
  const target = await ctx.grants.findActiveById(input.grantId);
  if (target === null) {
    throw new NotFoundError(`offene Freigabe "${input.grantId}" gibt es nicht`);
  }

  return audited(
    ctx,
    {
      actor: input.actor,
      action: 'revoke',
      resource: target.resource,
      detail: {
        grantId: target.id,
        subject: `${target.subject.kind}:${target.subject.id}`,
        verb: target.verb,
      },
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    },
    async () => {
      await requireAuthorityOver(ctx, input.actor, target.resource, 'write');

      const revoked = await ctx.grants.revoke(
        target.id,
        `${input.actor.kind}:${input.actor.id}`,
        ctx.clock.now(),
      );

      await syncDatabaseGrant(ctx, revoked, 'revoke');

      return { value: revoked, detail: { grantId: revoked.id } };
    },
  );
}

export async function listGrants(
  ctx: DomainContext,
  input: { actor: Actor; resource?: ResourceRef; subject?: SubjectRef },
): Promise<readonly Grant[]> {
  if (input.resource !== undefined) {
    await requireAuthorityOver(ctx, input.actor, input.resource, 'read');
    return ctx.grants.listForResource(input.resource);
  }
  if (input.subject !== undefined) {
    const own = input.subject.kind === input.actor.kind && input.subject.id === input.actor.id;
    if (!own) {
      // Fremde Freigaben zu lesen ist selbst ein Recht; ohne Wildcard-read
      // auf Apps sieht man nur die eigenen.
      await requirePermission(ctx, input.actor, 'read', { kind: 'app', id: '*' });
    }
    return ctx.grants.listForSubjects([input.subject]);
  }
  await requirePermission(ctx, input.actor, 'read', { kind: 'app', id: '*' });
  return ctx.grants.listAll(500);
}

/**
 * Prueft ein Tool-Recht. Der Plattform-MCP ruft genau das vor jedem
 * Tool-Aufruf auf (DoD 6).
 */
export async function canCallTool(
  ctx: DomainContext,
  actor: Actor,
  toolResourceId: string,
): Promise<boolean> {
  return can(ctx, actor, 'execute', { kind: 'tool', id: toolResourceId });
}

/**
 * Setzt eine Freigabe zwischen Apps auf Postgres-Ebene durch. Nur dort, wo das
 * sinnvoll ist: App-Subjekt auf Tabelle oder View. Fuer Menschen, Gruppen und
 * Agents gibt es in Postgres kein Gegenstueck — bei ihnen prueft das Gateway
 * bzw. der MCP.
 */
async function syncDatabaseGrant(
  ctx: DomainContext,
  entry: Grant,
  direction: 'grant' | 'revoke',
): Promise<void> {
  if (entry.subject.kind !== 'app') return;
  if (entry.resource.kind !== 'table' && entry.resource.kind !== 'view') return;
  if (entry.verb !== 'read') return; // Schreibzugriff zwischen Apps gibt es in v1 nicht.

  const grantee = await ctx.apps.findByName(entry.subject.id);
  if (grantee === null) {
    throw new NotFoundError(`App "${entry.subject.id}" gibt es nicht`);
  }
  const { appName, objectName } = parseObjectResourceId(entry.resource.id);
  const owner = await ctx.apps.findByName(appName);
  if (owner === null) {
    throw new NotFoundError(`App "${appName}" gibt es nicht`);
  }

  const payload = { grantee: grantee.dbRole, schemaName: owner.schemaName, objectName };
  if (direction === 'grant') {
    await ctx.provisioner.grantSelect(payload);
  } else {
    await ctx.provisioner.revokeSelect(payload);
  }
}
