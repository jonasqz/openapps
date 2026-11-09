/**
 * Deployen und zuruecksetzen. Der Ablauf ist absichtlich geradeaus:
 * Freigabe pruefen, Deployment anlegen, Review-Gate laufen lassen, und nur bei
 * `pass` an das Backend uebergeben. Es gibt keinen Pfad, der das Gate umgeht.
 */

import { audited } from './audit';
import { requireAppPermission } from './apps';
import { ConflictError, NotFoundError, ReviewBlockedError } from './errors';
import type { DomainContext } from './context';
import type { CodeFacts, ReviewResult } from './review-gate/types';
import type { Actor, App, AppManifest, Deployment } from './types';

export interface RequestDeployInput {
  readonly actor: Actor;
  readonly appIdOrName: string;
  readonly version: string;
  readonly gitSha: string;
  /** Arbeitskopie, in der die Scanner laufen. */
  readonly repoDir: string;
  /**
   * Das `app.json` aus dieser Arbeitskopie. Ohne Angabe wird das zuletzt
   * gespeicherte Manifest geprueft — dann muss die Version dazu passen.
   * Bei Erfolg wird das gepruefte Manifest das neue gespeicherte.
   */
  readonly manifest?: AppManifest;
  readonly uiActions?: readonly string[];
  readonly codeFacts?: CodeFacts;
  readonly correlationId?: string;
}

export interface DeployOutcome {
  readonly deployment: Deployment;
  readonly review: ReviewResult;
}

export async function requestDeploy(
  ctx: DomainContext,
  input: RequestDeployInput,
): Promise<DeployOutcome> {
  const app = await resolveApp(ctx, input.appIdOrName);

  return audited(
    ctx,
    {
      actor: input.actor,
      action: 'request_deploy',
      resource: { kind: 'app', id: app.id },
      detail: { version: input.version, gitSha: input.gitSha },
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    },
    async () => {
      await requireAppPermission(ctx, input.actor, 'write', app);

      const existing = await ctx.deployments.listByApp(app.id);
      if (existing.some((d) => d.version === input.version && d.status === 'live')) {
        throw new ConflictError(`Version "${input.version}" ist schon live`);
      }

      let deployment = await ctx.deployments.create({
        appId: app.id,
        version: input.version,
        gitSha: input.gitSha,
        requestedBy: `${input.actor.kind}:${input.actor.id}`,
      });
      deployment = await ctx.deployments.patch(deployment.id, { status: 'reviewing' });

      const manifest = input.manifest ?? app.manifest;

      const review = await ctx.reviewGate.run({
        appId: app.id,
        deploymentId: deployment.id,
        version: input.version,
        gitSha: input.gitSha,
        repoDir: input.repoDir,
        manifest,
        uiActions: input.uiActions ?? [],
        codeFacts: input.codeFacts ?? { tables: [], tools: [], envVars: [] },
      });

      deployment = await ctx.deployments.patch(deployment.id, {
        status: review.decision === 'pass' ? 'deploying' : 'blocked',
        reviewDecision: review.decision,
        reviewResult: review,
        reviewedAt: ctx.clock.now(),
      });

      if (review.decision === 'blocked') {
        // Der Fehler traegt die Deployment-Id, damit der Nachweis zum Befund
        // auffindbar bleibt (DoD 4).
        throw new ReviewBlockedError(review.summary, deployment.id);
      }

      const backendRef = await ensureBackendApp(ctx, app, existing);
      const result = await ctx.backend.deploy({ backendRef, gitSha: input.gitSha });

      deployment = await ctx.deployments.patch(deployment.id, {
        status: result.ok ? 'live' : 'failed',
        backendRef: result.backendRef,
        ...(result.ok ? { deployedAt: ctx.clock.now() } : {}),
      });

      if (result.ok) {
        if (app.currentDeploymentId !== null) {
          await ctx.deployments.patch(app.currentDeploymentId, { status: 'superseded' });
        }
        await ctx.apps.setDeploymentPointers(app.id, deployment.id, app.currentDeploymentId);
        // Erst nach dem erfolgreichen Deploy gilt das neue Manifest. Ein
        // blockierter Versuch aendert am Register nichts.
        await ctx.apps.setManifest(app.id, manifest);
      }

      return {
        value: { deployment, review },
        detail: {
          deploymentId: deployment.id,
          decision: review.decision,
          blocking: review.blockingFindings.map((f) => f.code),
        },
      };
    },
  );
}

export interface RollbackInput {
  readonly actor: Actor;
  readonly appIdOrName: string;
  readonly correlationId?: string;
}

/**
 * Zurueck auf die Vorversion. Ein Zeiger-Tausch plus ein Backend-Aufruf —
 * mehr nicht, damit DoD 5 (unter 2 Minuten) nicht an uns scheitert.
 */
export async function rollback(ctx: DomainContext, input: RollbackInput): Promise<Deployment> {
  const app = await resolveApp(ctx, input.appIdOrName);

  return audited(
    ctx,
    {
      actor: input.actor,
      action: 'rollback',
      resource: { kind: 'app', id: app.id },
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    },
    async () => {
      await requireAppPermission(ctx, input.actor, 'write', app);

      if (app.previousDeploymentId === null) {
        throw new ConflictError(`App "${app.name}" hat keine Vorversion`);
      }
      const target = await ctx.deployments.findById(app.previousDeploymentId);
      if (target === null) {
        throw new NotFoundError('Vorversion ist nicht mehr auffindbar');
      }

      const backendRef = target.backendRef;
      if (backendRef === null) {
        throw new ConflictError('die Vorversion hat keine Referenz im Deploy-Backend');
      }
      const result = await ctx.backend.rollback(backendRef, target.gitSha);
      if (!result.ok) {
        throw new ConflictError(`Rollback fehlgeschlagen: ${result.message ?? 'kein Grund'}`);
      }

      if (app.currentDeploymentId !== null) {
        await ctx.deployments.patch(app.currentDeploymentId, { status: 'rolled_back' });
      }
      const restored = await ctx.deployments.patch(target.id, {
        status: 'live',
        deployedAt: ctx.clock.now(),
      });
      // Die zurueckgesetzte Version wird die neue Vorversion; ein zweiter
      // Rollback fuehrt also zurueck, nicht im Kreis.
      await ctx.apps.setDeploymentPointers(app.id, restored.id, app.currentDeploymentId);

      return {
        value: restored,
        detail: { deploymentId: restored.id, version: restored.version },
      };
    },
  );
}

export async function listDeployments(
  ctx: DomainContext,
  input: { actor: Actor; appIdOrName: string },
): Promise<readonly Deployment[]> {
  const app = await resolveApp(ctx, input.appIdOrName);
  await requireAppPermission(ctx, input.actor, 'read', app);
  return ctx.deployments.listByApp(app.id);
}

/**
 * Beim ersten Deploy entsteht die App im Deploy-Backend — und zwar gleich
 * hinter dem Gateway. Es gibt keinen Zweig, der eine App deployt, ohne
 * `ensureGateway` zu rufen: eine App ohne Forward-Auth waere offen erreichbar
 * (DoD 2).
 */
async function ensureBackendApp(
  ctx: DomainContext,
  app: App,
  existing: readonly Deployment[],
): Promise<string> {
  const known = existing.find((d) => d.backendRef !== null)?.backendRef;
  if (known !== undefined && known !== null) return known;

  if (app.primaryDomain === null) {
    throw new ConflictError(
      `App "${app.name}" hat keine Domain. Ohne Domain gibt es keinen Router und keine Forward-Auth.`,
    );
  }
  if (app.source.kind !== 'git') {
    throw new ConflictError(
      `Quelle "${app.source.kind}" kann nicht deployt werden; in v1 nur Git-Quellen.`,
    );
  }

  const created = await ctx.backend.createApp({
    appName: app.name,
    gitUrl: app.source.url,
    gitRef: app.source.ref ?? 'main',
    domain: app.primaryDomain,
  });
  await ctx.backend.ensureGateway(created.backendRef, {
    appName: app.name,
    domain: app.primaryDomain,
  });
  return created.backendRef;
}

async function resolveApp(ctx: DomainContext, appIdOrName: string): Promise<App> {
  const app = (await ctx.apps.findById(appIdOrName)) ?? (await ctx.apps.findByName(appIdOrName));
  if (app === null) throw new NotFoundError(`App "${appIdOrName}" gibt es nicht`);
  return app;
}
