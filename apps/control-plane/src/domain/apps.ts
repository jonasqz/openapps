/**
 * Apps anlegen und auflisten. Frei von HTTP und frei von jedem Anbieternamen:
 * das Deploy-Backend ist nur `ctx.backend`.
 */

import { audited } from './audit';
import { can, canSubjects, requirePermission } from './can';
import { ConflictError, NotFoundError, PermissionDeniedError } from './errors';
import { appsDomainFor, assertNewAppName, dbRoleFor, schemaNameFor } from './naming';
import type { DomainContext } from './context';
import type { Actor, App, AppManifest, ManifestSource, SubjectRef, Verb } from './types';
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

/**
 * Wie `canAccessApp`, fuer Subjekte ohne Aufrufer (`canSubjects`): eine
 * Person ueber ihre E-Mail und Gruppen, beim Ableiten der Benachrichtigungen.
 */
export async function subjectsCanAccessApp(
  ctx: DomainContext,
  subjects: readonly SubjectRef[],
  verb: Verb,
  app: Pick<App, 'id' | 'name'>,
): Promise<boolean> {
  if (await canSubjects(ctx, subjects, verb, { kind: 'app', id: app.id })) return true;
  return canSubjects(ctx, subjects, verb, { kind: 'app', id: app.name });
}

export async function requireAppPermission(
  ctx: DomainContext,
  actor: Actor,
  verb: Verb,
  app: Pick<App, 'id' | 'name'>,
): Promise<void> {
  if (!(await canAccessApp(ctx, actor, verb, app))) {
    throw new PermissionDeniedError(`${actor.kind}:${actor.id} may not ${verb} on app:${app.name}`);
  }
}

export interface CreateAppInput {
  readonly actor: Actor;
  readonly name: string;
  readonly displayName?: string;
  readonly manifest: AppManifest;
  /**
   * Ein **bestehendes** Repo. Ohne Angabe legt die Control Plane eines aus dem
   * Starter-Template an (der Normalweg, DoD 1). Mit Angabe wird keines
   * angelegt — das ist der Weg fuer eine App, deren Repo schon existiert
   * (spaeter: Installation aus dem Katalog).
   */
  readonly source?: ManifestSource;
  readonly correlationId?: string;
}

/**
 * Legt die App an: erst das Repo, dann Schema und DB-Rolle, zuletzt der
 * Eintrag im Register (ADR 0012).
 *
 * Die Reihenfolge ist kein Zufall. Der Register-Eintrag ist ein einziges
 * INSERT, mit Domain, und kommt als letzter Schritt. Scheitert vorher etwas,
 * steht keine App im Register — weder eine, die auf ein Repo zeigt, das es
 * nicht gibt, noch eine ohne Schema oder ohne Domain, die jeden spaeteren
 * Deploy blockiert. Was davor schon entstand, schadet nicht: Schema und Rolle
 * legt `provision` idempotent an, ein zweiter Versuch nimmt sie einfach mit.
 *
 * Die Quelle setzt die Control Plane, nicht der Aufrufer: was im uebergebenen
 * Manifest unter `source` stand, wird durch das tatsaechlich angelegte Repo
 * ersetzt. Eine App soll nicht bestimmen koennen, woraus sie gebaut wird.
 *
 * Nach dem Anlegen gibt es noch kein Deployment: live wird die App erst durch
 * `requestDeploy`, und sichtbar erst durch eine Freigabe.
 */
export async function createApp(ctx: DomainContext, input: CreateAppInput): Promise<App> {
  const { actor, name } = input;
  assertNewAppName(name);

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
        throw new ConflictError(`App "${name}" already exists`);
      }

      const schemaName = schemaNameFor(name);
      const dbRole = dbRoleFor(name);
      const displayName = input.displayName ?? input.manifest.displayName;

      // Erst das Repo. Scheitert es, wird nichts registriert.
      const source =
        input.source ??
        (await createRepository(ctx, {
          appName: name,
          description: input.manifest.description,
          requestedBy: `${actor.kind}:${actor.id}`,
        }));

      // Eigenes Schema, eigene Rolle — die Grundlage von DoD 3. Vor dem
      // Register, damit es keine registrierte App ohne Schema gibt.
      await ctx.provisioner.provision({ schemaName, dbRole });

      // Zuletzt das Register, in einem Schritt. Die Domain ist fuer jede App
      // dieselbe (ADR 0007); erreichbar wird die App ueber ihren Pfad
      // `appPathFor(name)`.
      const app = await ctx.apps.create({
        name,
        displayName,
        category: input.manifest.category,
        // Das Manifest fuehrt dieselbe Quelle wie das Register: eine Wahrheit.
        manifest: { ...input.manifest, source },
        source,
        schemaName,
        dbRole,
        createdBy: `${actor.kind}:${actor.id}`,
        primaryDomain: ctx.appsDomain === undefined ? null : appsDomainFor(ctx.appsDomain),
      });

      return {
        value: app,
        detail: {
          appId: app.id,
          schemaName,
          dbRole,
          git: source.git,
          tag: source.tag,
          repoCreated: input.source === undefined,
        },
      };
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

async function createRepository(
  ctx: DomainContext,
  spec: { appName: string; description: string; requestedBy: string },
): Promise<ManifestSource> {
  const created = await ctx.repositories.createFromTemplate(spec);
  return { git: created.gitUrl, tag: created.tag };
}

export async function getApp(ctx: DomainContext, actor: Actor, appIdOrName: string): Promise<App> {
  const app = (await ctx.apps.findById(appIdOrName)) ?? (await ctx.apps.findByName(appIdOrName));
  if (app === null) throw new NotFoundError(`App "${appIdOrName}" does not exist`);
  await requireAppPermission(ctx, actor, 'read', app);
  return app;
}
