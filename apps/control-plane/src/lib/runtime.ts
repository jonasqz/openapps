/**
 * Hier wird die Domaene zusammengesteckt — und nur hier. Die Route-Handler
 * bekommen einen fertigen `DomainContext` und wissen nicht, was dahinter
 * steckt: Postgres, Coolify, echte Scanner.
 */

import { createConfiguredBackend, createConfiguredGatewayLabelLint } from '../adapters/coolify';
import { createConfiguredRepositoryBackend } from '../adapters/github';
import { systemClock, uuidIds, type DomainContext } from '../domain';
import { createDefaultPipeline } from '../domain/review-gate';
import {
  createAgentIdentityRepository,
  createGroupMembershipRepository,
  createAppRepository,
  createAuditRepository,
  createDeploymentRepository,
  createGrantRepository,
  createPgProvisioner,
  getPool,
} from '../infra/pg';
import { createAlarmSink } from '../infra/alarms';
import { gitleaksScanner, semgrepScanner } from '../infra/scanners';
import { setSessionReaderFactory } from './actor';
import { getAuth } from './auth';
import { readEnv } from './env';
import { createBetterAuthSessionReader } from './session';

let context: DomainContext | undefined;

export function domainContext(): DomainContext {
  if (context !== undefined) return context;

  const env = readEnv();
  const pool = getPool();
  // Eine Instanz, zweimal gebraucht: im Review-Gate vor dem Deploy und in
  // `requestDeploy` gegen die zurueckgelesenen Labels danach.
  const gatewayLint = createConfiguredGatewayLabelLint();

  context = {
    apps: createAppRepository(pool),
    deployments: createDeploymentRepository(pool),
    grants: createGrantRepository(pool),
    audit: createAuditRepository(pool),
    agents: createAgentIdentityRepository(pool),
    clock: systemClock,
    ids: uuidIds,
    backend: createConfiguredBackend(),
    gatewayLint,
    repositories: createConfiguredRepositoryBackend(),
    reviewGate: createDefaultPipeline({
      gitleaks: gitleaksScanner(env.gitleaksBinary),
      semgrep: semgrepScanner(env.semgrepBinary),
      // Der Label-Lint vor dem Deploy. Nicht optional: ohne ihn blockiert das
      // Gate, statt einen Deploy ohne Gateway-Pruefung durchzulassen.
      gatewayLint,
      gatewayNetwork: env.gatewayNetwork,
      // UI-Linter-Regeln liefert der UI-Agent; bis dahin wird der Schritt
      // uebersprungen und blockiert nicht.
      // Claude-Report wird nachgezogen; das Gate bleibt ohne ihn gueltig.
    }),
    provisioner: createPgProvisioner(pool, {
      // Keine `options=`- und keine `search_path`-Angabe in der URL: das SDK
      // weist eine solche DSN ab (`assertAppConnectionString`) und setzt den
      // search_path selbst aus `DATABASE_SCHEMA`.
      appDsnTemplate: ({ role, password }) =>
        `postgres://${role}:${encodeURIComponent(password)}@${env.appDatabaseHost}`,
    }),
    authMasterSecret: env.authMasterSecret,
    alarms: createAlarmSink(),
    ...(env.baseDomain === undefined ? {} : { baseDomain: env.baseDomain }),
  };

  return context;
}

/**
 * Die echte Verdrahtung: Better Auth fuer die Session, die Datenbank fuer die
 * Gruppen. Registriert wird nur der **Weg** dorthin, nicht die Instanz — sie
 * entsteht beim ersten Aufruf, der eine Session braucht. Fehlt dann eine
 * Auth-Variable, wirft `readAuthEnv`; bis dahin gilt Default-Deny.
 *
 * Steht hier und nicht in `actor.ts`, damit die Tests ohne Auth laufen: sie
 * importieren `runtime.ts` nicht und bleiben bei `denyAllSessions`.
 */
setSessionReaderFactory(() =>
  createBetterAuthSessionReader({
    auth: getAuth(),
    groups: createGroupMembershipRepository(getPool()),
  }),
);

/** Fuer Tests und Skripte: einen eigenen Kontext einsetzen. */
export function setDomainContext(replacement: DomainContext | undefined): void {
  context = replacement;
}
