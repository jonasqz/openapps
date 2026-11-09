/**
 * Der Kontext, den jede Domaenenfunktion bekommt. Er enthaelt nur Anschluesse,
 * keinen Zustand. Wer ihn baut, entscheidet ueber Speicher und Backend —
 * die Domaene nicht.
 */

import type {
  AgentIdentityRepository,
  AlarmSink,
  AppRepository,
  AuditRepository,
  Clock,
  DeploymentBackend,
  DeploymentRepository,
  GatewayLabelLint,
  GrantRepository,
  IdGenerator,
  RepositoryBackend,
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
  /**
   * Der Label-Lint: einmal vor dem Deploy im Review-Gate, einmal danach gegen
   * die zurueckgelesenen Labels (Spec Woche 1, Abschnitt 1). Er rechnet nur —
   * das Netz spricht `backend`.
   */
  readonly gatewayLint: GatewayLabelLint;
  /** Legt das App-Repo aus dem Starter-Template an (DoD 1). */
  readonly repositories: RepositoryBackend;
  readonly reviewGate: ReviewPipeline;
  readonly provisioner: SchemaProvisioner;
  /**
   * Die **eine** Domain, unter der alle Apps liegen (ADR 0007). Jede App
   * bekommt diese Domain als `primaryDomain`; getrennt werden die Apps ueber
   * ihren Pfad `appPathFor(name)`, nicht ueber eine Subdomain. Ohne Angabe
   * vergibt die Control Plane keine Domain und der Deploy bleibt intern.
   */
  readonly appsDomain?: string;
  /**
   * Master-Secret, aus dem pro App das `OPENAPPS_AUTH_SECRET` abgeleitet wird
   * (siehe `src/lib/app-secret.ts`). Es verlaesst die Control Plane nie.
   */
  readonly authMasterSecret: string;
  /**
   * Wohin ein lauter, aber nicht abbrechender Befund geht (`/healthz`, Log).
   * Fehlt die Senke, bleibt der Befund im Audit-Log und am Deployment — er
   * geht nie verloren, er ist nur weniger sichtbar.
   */
  readonly alarms?: AlarmSink;
}

export const systemClock: Clock = { now: () => new Date() };

export const uuidIds: IdGenerator = { next: () => globalThis.crypto.randomUUID() };
