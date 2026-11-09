/**
 * Hier wird die Domaene zusammengesteckt — und nur hier. Die Route-Handler
 * bekommen einen fertigen `DomainContext` und wissen nicht, was dahinter
 * steckt: Postgres, Coolify, echte Scanner.
 */

import { createConfiguredBackend } from '../adapters/coolify';
import { systemClock, uuidIds, type DomainContext } from '../domain';
import { createDefaultPipeline } from '../domain/review-gate';
import {
  createAgentIdentityRepository,
  createAppRepository,
  createAuditRepository,
  createDeploymentRepository,
  createGrantRepository,
  createPgProvisioner,
  getPool,
} from '../infra/pg';
import { gitleaksScanner, semgrepScanner } from '../infra/scanners';
import { readEnv } from './env';

let context: DomainContext | undefined;

export function domainContext(): DomainContext {
  if (context !== undefined) return context;

  const env = readEnv();
  const pool = getPool();

  context = {
    apps: createAppRepository(pool),
    deployments: createDeploymentRepository(pool),
    grants: createGrantRepository(pool),
    audit: createAuditRepository(pool),
    agents: createAgentIdentityRepository(pool),
    clock: systemClock,
    ids: uuidIds,
    backend: createConfiguredBackend(),
    reviewGate: createDefaultPipeline({
      gitleaks: gitleaksScanner(env.gitleaksBinary),
      semgrep: semgrepScanner(env.semgrepBinary),
      // UI-Linter-Regeln liefert der UI-Agent; bis dahin wird der Schritt
      // uebersprungen und blockiert nicht.
      // Claude-Report wird nachgezogen; das Gate bleibt ohne ihn gueltig.
    }),
    provisioner: createPgProvisioner(pool, {
      appDsnTemplate: ({ role, password, schema }) =>
        `postgres://${role}:${password}@${env.appDatabaseHost}?options=-csearch_path%3D${schema}`,
    }),
    ...(env.baseDomain === undefined ? {} : { baseDomain: env.baseDomain }),
  };

  return context;
}

/** Fuer Tests und Skripte: einen eigenen Kontext einsetzen. */
export function setDomainContext(replacement: DomainContext | undefined): void {
  context = replacement;
}
