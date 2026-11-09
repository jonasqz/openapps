/**
 * Der Kontext, den jede Domaenenfunktion bekommt. Er enthaelt nur Anschluesse,
 * keinen Zustand. Wer ihn baut, entscheidet ueber Speicher und Backend —
 * die Domaene nicht.
 */

import type {
  AgentIdentityRepository,
  AppRepository,
  AuditRepository,
  Clock,
  DeploymentBackend,
  DeploymentRepository,
  GrantRepository,
  IdGenerator,
  SchemaProvisioner,
} from './ports';
import type { ReviewPipeline } from './review-gate/types';

export interface DomainContext {
  readonly apps: AppRepository;
  readonly deployments: DeploymentRepository;
  readonly grants: GrantRepository;
  readonly audit: AuditRepository;
  readonly agents: AgentIdentityRepository;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly backend: DeploymentBackend;
  readonly reviewGate: ReviewPipeline;
  readonly provisioner: SchemaProvisioner;
  /**
   * Basis-Domain fuer App-Domains: `<app-name>.<baseDomain>`. Ohne Angabe
   * vergibt die Control Plane keine Domain und der Deploy bleibt intern.
   */
  readonly baseDomain?: string;
}

export const systemClock: Clock = { now: () => new Date() };

export const uuidIds: IdGenerator = { next: () => globalThis.crypto.randomUUID() };
