/**
 * Apps anlegen und auflisten. Frei von HTTP und frei von jedem Anbieternamen:
 * das Deploy-Backend ist nur `ctx.backend`.
 */

import { audited } from './audit';
import { can, requirePermission } from './can';
import { ConflictError, NotFoundError, PermissionDeniedError } from './errors';
import { assertAppName, dbRoleFor, domainFor, schemaNameFor } from './naming';
import type { DomainContext } from './context';
import type { Actor, App, AppManifest, CatalogSource, Verb } from './types';
import { ANY } from './types';

/**
 * Eine Freigabe auf eine App darf auf die Id oder auf den Namen lauten. Der
 * Name ist das, was ein Mensch in `grant` tippt; die Id ist stabil. Beide
 * Wege sind gleichwertig, und beide muessen gepruefte Freigaben sein.
 */
export async function canAccessApp(
  ctx: DomainContext,
  actor: Actor,
  verb: Verb,
  app: Pick<App, 'id' | 'name'>,
): Promise<boolean> {
  if (await can(ctx, actor, verb, { kind: 'app', id: app.id })) return true;
  return can(ctx, actor, verb, { kind: 'app', id: app.name });
}

export async function requireAppPermission(
  ctx: DomainContext,
  actor: Actor,
  verb: Verb,
  app: Pick<App, 'id' | 'name'>,
): Promise<void> {
  if (!(await canAccessApp(ctx, actor, verb, app))) {
    throw new PermissionDeniedError(
      `${actor.kind}:${actor.id} darf nicht ${verb} auf app:${app.name}`,
    );
  }
}

export interface CreateAppInput {
  readonly actor: Actor;
  readonly name: string;
  readonly displayName?: string;
  readonly manifest: AppManifest;
  readonly source: CatalogSource;
  readonly correlationId?: string;
}

/**
 * Legt die App im Register an und richtet ihr Schema samt eigener DB-Rolle ein.
 * Das Repo selbst entsteht nicht hier — es kommt aus `source`.
 *
 * Nach dem Anlegen gibt es noch kein Deployment: live wird die App erst durch
 * `requestDeploy`, und sichtbar erst durch eine Freigabe.
 */
export async function createApp(ctx: DomainContext, input: CreateAppInput): Promise<App> {
  const { actor, name } = input;
  assertAppName(name);

  return audited(
    ctx,
    {
      actor,
      action: 'create_app',
      resource: { kind: 'app', id: name },
      detail: { source: input.source },
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    },
    async () => {
      await requirePermission(ctx, actor, 'write', { kind: 'app', id: ANY });

      if (await ctx.apps.findByName(name)) {
        throw new ConflictError(`App "${name}" gibt es schon`);
      }

      const schemaName = schemaNameFor(name);
      const dbRole = dbRoleFor(name);

      const app = await ctx.apps.create({
        name,
        displayName: input.displayName ?? input.manifest.displayName ?? name,
        category: input.manifest.category ?? null,
        manifest: input.manifest,
        source: input.source,
        schemaName,
        dbRole,
        createdBy: `${actor.kind}:${actor.id}`,
      });

      // Eigenes Schema, eigene Rolle — die Grundlage von DoD 3.
      await ctx.provisioner.provision({ schemaName, dbRole });

      if (ctx.baseDomain !== undefined) {
        await ctx.apps.setPrimaryDomain(app.id, domainFor(name, ctx.baseDomain));
      }

      return { value: app, detail: { appId: app.id, schemaName, dbRole } };
    },
  );
}

/**
 * Listet Apps. Default-Deny gilt auch beim Lesen: wer kein `read` auf eine App
 * hat, sieht sie nicht in der Liste.
 */
export async function listApps(
  ctx: DomainContext,
  input: { actor: Actor; correlationId?: string },
): Promise<readonly App[]> {
  const all = await ctx.apps.listAll();
  const visible: App[] = [];
  for (const app of all) {
    if (await canAccessApp(ctx, input.actor, 'read', app)) visible.push(app);
  }

  await ctx.audit.append({
    occurredAt: ctx.clock.now(),
    actor: { kind: input.actor.kind, id: input.actor.id },
    action: 'list_apps',
    resource: { kind: 'app', id: ANY },
    outcome: 'allowed',
    reason: null,
    detail: { visible: visible.length, total: all.length },
    correlationId: input.correlationId ?? null,
  });

  return visible;
}

export async function getApp(ctx: DomainContext, actor: Actor, appIdOrName: string): Promise<App> {
  const app =
    (await ctx.apps.findById(appIdOrName)) ?? (await ctx.apps.findByName(appIdOrName));
  if (app === null) throw new NotFoundError(`App "${appIdOrName}" gibt es nicht`);
  await requireAppPermission(ctx, actor, 'read', app);
  return app;
}
