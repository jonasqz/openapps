/**
 * Deployen und zuruecksetzen. Der Ablauf ist absichtlich geradeaus:
 * Freigabe pruefen, Deployment anlegen, Review-Gate laufen lassen, und nur bei
 * `pass` an das Backend uebergeben. Es gibt keinen Pfad, der das Gate umgeht.
 */

import { appAuthSecret } from './app-secret';
import { audited, record } from './audit';
import { requireAppPermission } from './apps';
import { appContainerPort } from './app-port';
import { appIdOf, gatewayHost } from './gateway-identity';
import { appPathFor } from './naming';
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
  /**
   * Der Label-Lint **nach** dem Deploy (Spec Woche 1, Abschnitt 1). Steht hier
   * am Ergebnis, damit ein Aufrufer — HTTP-Route, MCP-Tool — den Befund
   * weitergeben kann, ohne das Audit-Log zu lesen.
   */
  readonly gateway: GatewayLintReport;
}

/**
 * Was der Label-Lint nach dem Deploy ergeben hat. Vier Zustaende, und die
 * Unterscheidung ist der Zweck (dasselbe Muster wie
 * `src/infra/gateway-guard.ts`):
 *
 * - `clean` — gelesen, vollstaendig. Das ist eine Messung.
 * - `finding` — gelesen, unvollstaendig. Das ist ein Befund.
 * - `unreachable` — nicht gelesen. Das ist **kein** Befund: Ein Backend, das
 *   nicht antwortet, sagt nichts darueber, wie die App haengt.
 * - `skipped` — es gab nichts zu lesen, weil nicht deployt wurde.
 */
export type GatewayLintReport =
  | { readonly state: 'clean' }
  | {
      readonly state: 'finding';
      /** Fehlende oder abweichende Label-Schluessel. */
      readonly missing: readonly string[];
      readonly reason?: string;
    }
  | { readonly state: 'unreachable'; readonly reason: string }
  | { readonly state: 'skipped'; readonly reason: string };

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
        // Das Gateway-Ziel dieses Deploys. Der Port steht absichtlich nicht
        // dabei: Der Label-Lint leitet ihn aus dem Manifest der Arbeitskopie
        // ab, und ein unbrauchbarer Wert darin ist genau einer der Befunde.
        gateway: { appName: app.name, domain: app.primaryDomain },
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

      // Der zweite Lauf des Label-Lints, und der einzige, der etwas messen
      // kann: Was steht wirklich an der App, nachdem `ensureGateway` und der
      // Deploy gelaufen sind (Spec Woche 1, Abschnitt 1: „vor und nach jedem
      // Deploy")?
      const gateway: GatewayLintReport = result.ok
        ? await inspectGatewayLabels(ctx, app, result.backendRef)
        : { state: 'skipped', reason: 'der Deploy ist nicht gelaufen' };

      deployment = await ctx.deployments.patch(deployment.id, {
        // `degraded` statt `live`: Der Deploy laeuft, aber er gilt nicht als
        // sauber. Begruendung in Migration 0010 und bei `inspectGatewayLabels`.
        status: result.ok ? (gateway.state === 'finding' ? 'degraded' : 'live') : 'failed',
        backendRef: result.backendRef,
        ...(result.ok ? { deployedAt: ctx.clock.now() } : {}),
      });

      await reportGatewayLint(ctx, {
        actor: input.actor,
        app,
        deploymentId: deployment.id,
        report: gateway,
        ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
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
        value: { deployment, review, gateway },
        detail: {
          deploymentId: deployment.id,
          decision: review.decision,
          blocking: review.blockingFindings.map((f) => f.code),
          gatewayLabels: gateway.state,
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

/* -------------------------------------------------------------------------- */
/* Label-Lint nach dem Deploy                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Liest die Gateway-Labels der App zurueck und schickt sie durch den Lint.
 *
 * Warum diese Pruefung die wichtigere ist: Vor dem Deploy prueft die Control
 * Plane, was sie selbst ableiten wuerde — zum Teil eine Pruefung gegen sich
 * selbst. Hier wird gemessen. Ein Coolify-Update, das die Labels einer App
 * entfernt (Spec 2, Zeile „Coolify-Update entfernt oder ueberschreibt
 * App-Labels"; im Gateway-Lauf wirklich passiert), faellt nur hier auf.
 *
 * Was ein Befund **nicht** ist: ein Notfall. Der Schutz haengt am Entrypoint
 * (Spec 1.2), und eine App ohne Router landet am Catch-all mit 403. Die App
 * ist also kaputt, nicht offen. Deshalb wird hier nichts abgebrochen und
 * nichts zurueckgerollt — ein automatischer Rollback waere eine eigene
 * Entscheidung mit eigenen Folgen (er wuerde eine funktionierende Vorversion
 * ueber eine kaputte neue legen, ohne dass jemand den Befund gesehen hat).
 */
async function inspectGatewayLabels(
  ctx: DomainContext,
  app: App,
  backendRef: string,
): Promise<GatewayLintReport> {
  if (app.primaryDomain === null) {
    // Kann hier nicht passieren (ohne Domain gibt es keinen Deploy), steht
    // aber da, damit der Fall nicht still als `clean` endet.
    return { state: 'skipped', reason: 'die App hat keine Domain' };
  }

  let reading;
  try {
    reading = await ctx.backend.readGatewayLabels(backendRef);
  } catch (cause) {
    // Ein Fehler beim Lesen ist kein Befund ueber die Labels.
    return { state: 'unreachable', reason: cause instanceof Error ? cause.message : String(cause) };
  }
  if (reading.state === 'unreachable') {
    return { state: 'unreachable', reason: reading.reason };
  }

  let port: number;
  try {
    port = appContainerPort(app);
  } catch (cause) {
    // Wir haben gelesen, koennen aber nicht sagen, was richtig waere. Das ist
    // ein Befund und kein `unreachable`: Die Ursache liegt bei uns.
    return {
      state: 'finding',
      missing: [],
      reason: `Port nicht ableitbar: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }

  const missing = ctx.gatewayLint.missing(reading.labels, {
    appName: app.name,
    domain: app.primaryDomain,
    port,
  });

  return missing.length === 0 ? { state: 'clean' } : { state: 'finding', missing };
}

/**
 * Der Befund wird laut: eigener Audit-Eintrag, Alarm im Prozess (und damit in
 * `/healthz`). Das Statusfeld des Deployments steht beim Aufrufer auf
 * `degraded` — zusammen sind das die drei Stellen, an denen ein Mensch es
 * sieht, ohne danach zu suchen.
 */
async function reportGatewayLint(
  ctx: DomainContext,
  input: {
    actor: Actor;
    app: App;
    deploymentId: string;
    report: GatewayLintReport;
    correlationId?: string;
  },
): Promise<void> {
  const { app, report } = input;
  const subject = `app:${app.name}`;

  const problems =
    report.state === 'finding'
      ? [
          ...(report.reason === undefined ? [] : [report.reason]),
          ...report.missing.map((key) => `Label fehlt oder weicht ab: ${key}`),
        ]
      : [];

  if (report.state === 'finding') {
    ctx.alarms?.raise({ kind: 'gateway_labels', subject, problems });
  } else if (report.state === 'clean') {
    ctx.alarms?.clear('gateway_labels', subject);
  }

  await record(ctx, {
    actor: input.actor,
    action: 'gateway_label_lint',
    resource: { kind: 'app', id: app.id },
    // `error` nur beim Befund. `unreachable` ist kein Befund, steht aber mit
    // Grund im Log — sonst waere „wir wissen nichts" unsichtbar.
    outcome: report.state === 'finding' ? 'error' : 'allowed',
    reason: report.state === 'finding' ? problems.join(' | ') : null,
    detail: {
      deploymentId: input.deploymentId,
      state: report.state,
      ...(report.state === 'finding' ? { missing: report.missing } : {}),
      ...(report.state === 'unreachable' || report.state === 'skipped'
        ? { reason: report.reason }
        : {}),
    },
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
  });
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

  const created = await ctx.backend.createApp({
    appName: app.name,
    gitUrl: app.source.git,
    gitRef: app.source.tag,
    domain: app.primaryDomain,
  });

  // Reihenfolge: erst Env, dann Gateway, dann (beim Aufrufer) Deploy. Die App
  // startet nie, ohne ihre Env und ihren Router zu haben.
  await ctx.backend.setEnv(created.backendRef, appEnvironment(ctx, app, await freshDsn(ctx, app)));
  await ctx.backend.ensureGateway(created.backendRef, {
    appName: app.name,
    domain: app.primaryDomain,
    // Der Port gehoert zur App, nicht zum Backend: siehe `domain/app-port.ts`.
    port: appContainerPort(app),
  });
  return created.backendRef;
}

/**
 * Die DSN der App. Sie wird beim Anlegen des Backend-Containers neu gezogen,
 * weil das Passwort der App-Rolle nirgends gespeichert wird (Migration 0006
 * setzt es beim Aufruf). Das ist nur hier unschaedlich: Die App laeuft noch
 * nicht, also unterbricht die Neuvergabe keine offene Verbindung.
 */
async function freshDsn(ctx: DomainContext, app: App): Promise<string> {
  const { dsn } = await ctx.provisioner.provision({
    schemaName: app.schemaName,
    dbRole: app.dbRole,
  });
  return dsn;
}

/**
 * Die Env, die jede App bekommt. Mehr setzt die Control Plane nicht: was die
 * App darueber hinaus braucht, deklariert sie im Manifest.
 *
 * `OPENAPPS_APP_ID` und `OPENAPPS_APP_HOST` muessen **byte-gleich** dem sein,
 * was die Forward-Auth ins Signatur-Material schreibt (ADR 0004). Deshalb
 * stammen beide Werte aus denselben Funktionen wie dort: `app.name` und
 * `gatewayHost()`. `OPENAPPS_APP_BASE_PATH` kommt aus derselben einen Quelle
 * wie der Pfad des Routers: `appPathFor()`.
 */
function appEnvironment(
  ctx: DomainContext,
  app: App,
  dsn: string,
): Readonly<Record<string, string>> {
  if (app.primaryDomain === null) {
    throw new ConflictError(`App "${app.name}" hat keine Domain`);
  }
  return {
    DATABASE_URL: dsn,
    DATABASE_SCHEMA: app.schemaName,
    OPENAPPS_APP_ID: appIdOf(app),
    OPENAPPS_APP_HOST: gatewayHost(app.primaryDomain),
    // Der Pfad, unter dem diese App liegt (ADR 0007). Die App setzt ihn als
    // `basePath` ihres Frameworks — ohne ihn zeigen ihre Verweise, Bilder und
    // JavaScript-Dateien ins Leere. Abgeleitet wird er nur in
    // `domain/naming.ts`, damit Router, Env und Review-Gate denselben Wert
    // sehen.
    OPENAPPS_APP_BASE_PATH: appPathFor(app.name),
    OPENAPPS_AUTH_SECRET: appAuthSecret({
      masterSecret: ctx.authMasterSecret,
      appId: appIdOf(app),
      generation: app.authSecretGeneration,
    }),
  };
}

async function resolveApp(ctx: DomainContext, appIdOrName: string): Promise<App> {
  const app = (await ctx.apps.findById(appIdOrName)) ?? (await ctx.apps.findByName(appIdOrName));
  if (app === null) throw new NotFoundError(`App "${appIdOrName}" gibt es nicht`);
  return app;
}
