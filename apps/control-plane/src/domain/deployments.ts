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
import { buildGatewayConfig, gatewayConfigProblems } from './gateway-config';
import { appPathFor, gatewayAliasFor } from './naming';
import { ConflictError, NotFoundError, ReviewBlockedError } from './errors';
import type { DomainContext } from './context';
import type { GatewayDynamicConfig } from './gateway-config';
import type { AppGatewayFacts } from './ports';
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
   * Die Pruefung der Gateway-Konfiguration **nach** dem Deploy. Steht hier am
   * Ergebnis, damit ein Aufrufer — HTTP-Route, MCP-Tool — den Befund
   * weitergeben kann, ohne das Audit-Log zu lesen.
   */
  readonly gateway: GatewayConfigReport;
}

/**
 * Was die Pruefung der Gateway-Konfiguration **nach** dem Deploy ergeben hat.
 * Vier Zustaende, und die Unterscheidung ist der Zweck (dasselbe Muster wie
 * `src/infra/gateway-guard.ts`):
 *
 * - `clean` — gelesen, und die Datei auf dem Host ist die, die wir erzeugt
 *   haben; das Backend hat der App keinen eigenen Router gegeben. Messung.
 * - `finding` — gelesen und abweichend. Befund.
 * - `unreachable` — nicht gelesen. **Kein** Befund: Eine Datei, die sich nicht
 *   lesen laesst, sagt nichts darueber, wie die App haengt.
 * - `skipped` — es gab nichts zu lesen, weil nicht deployt wurde.
 */
export type GatewayConfigReport =
  | { readonly state: 'clean' }
  | {
      readonly state: 'finding';
      /** Was nicht traegt, als Satz je Befund. */
      readonly problems: readonly string[];
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
        // dabei: Der Konfigurations-Lint leitet ihn aus dem Manifest der Arbeitskopie
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

      // Der zweite Lauf des Konfigurations-Lints, und der einzige, der etwas
      // messen kann: Liegt unsere Datei so auf dem Host, wie wir sie
      // geschrieben haben, und hat das Backend der App keinen eigenen Router
      // gegeben (ADR 0008)?
      const gateway: GatewayConfigReport = result.ok
        ? await inspectGatewayConfig(ctx, app, result.backendRef)
        : { state: 'skipped', reason: 'der Deploy ist nicht gelaufen' };

      deployment = await ctx.deployments.patch(deployment.id, {
        // `degraded` statt `live`: Der Deploy laeuft, aber er gilt nicht als
        // sauber. Begruendung in Migration 0010 und bei `inspectGatewayConfig`.
        status: result.ok ? (gateway.state === 'finding' ? 'degraded' : 'live') : 'failed',
        backendRef: result.backendRef,
        ...(result.ok ? { deployedAt: ctx.clock.now() } : {}),
      });

      await reportGatewayConfig(ctx, {
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
          gatewayConfig: gateway.state,
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
/* Konfigurations-Lint nach dem Deploy                                         */
/* -------------------------------------------------------------------------- */

/**
 * Was wir dem Gateway sagen wuerden: die erzeugte Konfiguration fuer **alle**
 * registrierten Apps dieser Instanz.
 *
 * Warum alle und nicht nur die, die gerade deployt wird: Die Datei ist eine
 * Datei. Wer sie fuer eine App schreibt, loescht die Router aller anderen.
 * Also wird sie immer vollstaendig erzeugt — aus dem Register, der einen
 * Quelle, die weiss, welche Apps es gibt.
 *
 * Eine registrierte, aber noch nicht deployte App bekommt dabei einen Router,
 * dessen Dienst noch nicht antwortet: ihr Pfad gibt dann 502 statt 403. Das
 * ist kein Loch — die Forward-Auth laeuft davor —, aber es ist eine
 * Entscheidung: Die Alternative waere, pro App nachzusehen, ob sie schon eine
 * Backend-Referenz hat, und das sind N Abfragen fuer einen 404 statt eines
 * 502.
 */
export async function gatewayConfigFor(ctx: DomainContext): Promise<GatewayDynamicConfig> {
  if (ctx.appsDomain === undefined) {
    throw new ConflictError(
      'ohne APPS_DOMAIN gibt es keine gemeinsame Domain und damit keinen Router (ADR 0007)',
    );
  }
  const apps = await ctx.apps.listAll();
  return buildGatewayConfig({
    ...ctx.gatewaySettings,
    appsDomain: ctx.appsDomain,
    apps: apps.map((app) => ({
      appName: app.name,
      port: appContainerPort(app),
      networkAlias: gatewayAliasFor(app.name),
    })),
  });
}

/**
 * Schreibt die Gateway-Konfiguration. Es gibt keinen Deploy-Pfad, der das
 * ueberspringt: Ohne Router in **unserer** Datei ist eine App nicht erreichbar,
 * und mit einem Router ohne unsere Middlewares waere sie offen — den zweiten
 * Fall kann der Generator nicht erzeugen (`domain/gateway-config.ts`).
 *
 * Vor dem Schreiben laeuft der Lint auf der erzeugten Struktur. Ein Befund
 * hier ist kein `degraded`, sondern ein Abbruch: Eine Konfiguration, von der
 * wir wissen, dass sie nicht traegt, wird nicht ausgerollt.
 */
async function publishGatewayConfig(ctx: DomainContext): Promise<GatewayDynamicConfig> {
  const config = await gatewayConfigFor(ctx);
  const problems = gatewayConfigProblems(config);
  if (problems.length > 0) {
    throw new ConflictError(
      `die erzeugte Gateway-Konfiguration traegt nicht: ${problems.join(' | ')}`,
    );
  }
  await ctx.gatewayConfig.publish(config);
  return config;
}

/**
 * Schreibt die Gateway-Konfiguration beim Start der Control Plane — dieselbe
 * Funktion wie nach jedem Deploy, nur ohne Deploy davor.
 *
 * Ohne diesen Aufruf gaebe es auf einem frischen Server keinen Router fuer die
 * Control Plane: Die Datei entstand bisher nur bei einem App-Deploy, ein
 * Deploy braucht eine Anmeldung, und die Anmeldung braucht den Router. Ein
 * Henne-Ei-Problem, das erst auf dem Zielserver aufgefallen waere.
 *
 * Auch nach einem Neustart ist das richtig: Die Datei wird aus der Datenbank
 * neu erzeugt, also aus dem Stand, den die Control Plane fuer wahr haelt —
 * nicht aus dem, was zufaellig noch auf dem Host liegt.
 */
export async function publishGatewayAtStartup(ctx: DomainContext): Promise<GatewayDynamicConfig> {
  return publishGatewayConfig(ctx);
}

/**
 * Die Messung nach dem Deploy. Zwei Fragen, und beide kann nur diese Stelle
 * beantworten:
 *
 *  1. Liegt unsere Datei so auf dem Host, wie wir sie geschrieben haben? Das
 *     faengt den Fall, dass jemand oder etwas sie veraendert hat — und den,
 *     dass das Schreiben nur scheinbar gelaufen ist.
 *  2. Hat das Deploy-Backend der App einen **eigenen** Weg nach innen gegeben?
 *     Unter ADR 0008 ist das die gefaehrliche Richtung: Eine von Coolify
 *     erzeugte Domain bringt einen Router **ohne** unsere Middlewares mit
 *     (`ApplicationsController.php:1690`), ein `ports_mappings` macht den
 *     Container am Gateway vorbei erreichbar.
 *
 * Was ein Befund **nicht** ist: ein Notfall mit automatischem Rollback. Der
 * waere eine eigene Entscheidung mit eigenen Folgen — er legt eine
 * funktionierende Vorversion ueber eine neue, ohne dass jemand den Befund
 * gesehen hat. Hier wird gemeldet, nicht gehandelt.
 */
async function inspectGatewayConfig(
  ctx: DomainContext,
  app: App,
  backendRef: string,
): Promise<GatewayConfigReport> {
  const problems: string[] = [];

  let config: GatewayDynamicConfig;
  try {
    config = await gatewayConfigFor(ctx);
  } catch (cause) {
    // Wir koennen nicht sagen, was richtig waere. Das ist ein Befund und kein
    // `unreachable`: Die Ursache liegt bei uns.
    return {
      state: 'finding',
      problems: [
        `Gateway-Konfiguration nicht ableitbar: ${cause instanceof Error ? cause.message : String(cause)}`,
      ],
    };
  }

  let verification;
  try {
    verification = await ctx.gatewayConfig.verify(config);
  } catch (cause) {
    return { state: 'unreachable', reason: cause instanceof Error ? cause.message : String(cause) };
  }
  if (verification.state === 'unreachable') {
    return { state: 'unreachable', reason: verification.reason };
  }
  if (verification.state === 'mismatch') {
    problems.push(...verification.problems);
  }

  let reading;
  try {
    reading = await ctx.backend.readAppGatewayFacts(backendRef);
  } catch (cause) {
    return { state: 'unreachable', reason: cause instanceof Error ? cause.message : String(cause) };
  }
  if (reading.state === 'unreachable') {
    // Die Datei konnten wir lesen, die App-Seite nicht. Ein halber Befund ist
    // keiner: Was wir an der Datei gesehen haben, steht trotzdem im Bericht.
    return problems.length > 0
      ? { state: 'finding', problems }
      : { state: 'unreachable', reason: reading.reason };
  }

  problems.push(...ownRouterProblems(app, reading.facts));
  return problems.length === 0 ? { state: 'clean' } : { state: 'finding', problems };
}

/**
 * Hat das Deploy-Backend der App einen eigenen Weg nach innen gegeben? Unter
 * ADR 0008 ist die richtige Antwort: nichts. Keine `traefik.*`-Label, kein
 * Host-Port, keine Domain.
 */
export function ownRouterProblems(
  app: Pick<App, 'name'>,
  facts: AppGatewayFacts,
): readonly string[] {
  const problems: string[] = [];

  const traefikLabels = Object.keys(facts.labels).filter((key) =>
    key.trim().toLowerCase().startsWith('traefik.'),
  );
  if (traefikLabels.length > 0) {
    problems.push(
      `das Deploy-Backend fuehrt an "${app.name}" eigene Traefik-Labels [${traefikLabels.join(', ')}] — ` +
        'ein Router daraus traegt unsere Middlewares nicht (ADR 0008)',
    );
  }

  if (facts.portsMappings.trim() !== '') {
    problems.push(
      `die App "${app.name}" veroeffentlicht den Host-Port "${facts.portsMappings.trim()}" — ` +
        'dann ist der Container am Gateway vorbei erreichbar und die Signatur aus Spec 3.2 ist wertlos',
    );
  }

  if (facts.domains.trim() !== '') {
    problems.push(
      `das Deploy-Backend hat "${app.name}" die Domain "${facts.domains.trim()}" gegeben — ` +
        'daraus entsteht ein Router ohne unsere Middlewares (ADR 0008, autogenerate_domain)',
    );
  }

  return problems;
}

/**
 * Der Befund wird laut: eigener Audit-Eintrag, Alarm im Prozess (und damit in
 * `/healthz`). Das Statusfeld des Deployments steht beim Aufrufer auf
 * `degraded` — zusammen sind das die drei Stellen, an denen ein Mensch es
 * sieht, ohne danach zu suchen.
 */
async function reportGatewayConfig(
  ctx: DomainContext,
  input: {
    actor: Actor;
    app: App;
    deploymentId: string;
    report: GatewayConfigReport;
    correlationId?: string;
  },
): Promise<void> {
  const { app, report } = input;
  const subject = `app:${app.name}`;

  const problems = report.state === 'finding' ? report.problems : [];

  if (report.state === 'finding') {
    ctx.alarms?.raise({ kind: 'gateway_config', subject, problems });
  } else if (report.state === 'clean') {
    ctx.alarms?.clear('gateway_config', subject);
  }

  await record(ctx, {
    actor: input.actor,
    action: 'gateway_config_lint',
    resource: { kind: 'app', id: app.id },
    // `error` nur beim Befund. `unreachable` ist kein Befund, steht aber mit
    // Grund im Log — sonst waere „wir wissen nichts" unsichtbar.
    outcome: report.state === 'finding' ? 'error' : 'allowed',
    reason: report.state === 'finding' ? problems.join(' | ') : null,
    detail: {
      deploymentId: input.deploymentId,
      state: report.state,
      ...(report.state === 'finding' ? { problems: report.problems } : {}),
      ...(report.state === 'unreachable' || report.state === 'skipped'
        ? { reason: report.reason }
        : {}),
    },
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
  });
}

/**
 * Beim ersten Deploy entsteht die App im Deploy-Backend — **ohne Domain** und
 * ohne eigenen Router (ADR 0008). Erreichbar wird sie allein ueber den Router
 * in unserer dynamischen Konfiguration.
 *
 * Es gibt keinen Zweig, der eine App deployt, ohne die Konfiguration zu
 * schreiben: Ohne sie waere die App nicht erreichbar, und ein Router ohne
 * Forward-Auth kann aus dem Generator nicht herauskommen (DoD 2).
 */
async function ensureBackendApp(
  ctx: DomainContext,
  app: App,
  existing: readonly Deployment[],
): Promise<string> {
  const known = existing.find((d) => d.backendRef !== null)?.backendRef;
  if (known !== undefined && known !== null) {
    // Auch bei einem bekannten Backend wird die Konfiguration neu geschrieben:
    // Der Port kann sich mit dem Manifest geaendert haben, und die Datei soll
    // nach jedem Deploy die Wahrheit sein.
    await publishGatewayConfig(ctx);
    return known;
  }

  if (app.primaryDomain === null) {
    throw new ConflictError(
      `App "${app.name}" hat keine Domain. Ohne Domain gibt es keinen Router und keine Forward-Auth.`,
    );
  }

  const created = await ctx.backend.createApp({
    appName: app.name,
    gitUrl: app.source.git,
    gitRef: app.source.tag,
    // Der Alias, unter dem unser Dienst die App anspricht — nicht der
    // Containername, der bei jedem Deploy ein neues Zeitstempel-Suffix
    // bekommt (ADR 0008).
    networkAlias: gatewayAliasFor(app.name),
    port: appContainerPort(app),
  });

  // Reihenfolge: erst Env, dann die Gateway-Konfiguration, dann (beim
  // Aufrufer) der Deploy. Die App startet nie, ohne ihre Env zu haben, und
  // kein Pfad wird erreichbar, ohne durch die Forward-Auth zu laufen.
  await ctx.backend.setEnv(created.backendRef, appEnvironment(ctx, app, await freshDsn(ctx, app)));
  await publishGatewayConfig(ctx);
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
