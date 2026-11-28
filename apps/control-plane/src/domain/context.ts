/**
 * Der Kontext, den jede Domaenenfunktion bekommt. Er enthaelt nur Anschluesse,
 * keinen Zustand. Wer ihn baut, entscheidet ueber Speicher und Backend —
 * die Domaene nicht.
 */

import type {
  AgentIdentityRepository,
  AgentProfileRepository,
  AgentRunRepository,
  AlarmSink,
  AppRepository,
  AuditRepository,
  Clock,
  DeploymentBackend,
  DeploymentRepository,
  EventRepository,
  GatewayConfigStore,
  GrantRepository,
  GroupRepository,
  IdGenerator,
  ModelSetup,
  ModelUsageRepository,
  RefRepository,
  RepositoryBackend,
  SchemaProvisioner,
  TeamMemoryStore,
  UserDirectory,
} from './ports';
import type { ReviewPipeline } from './review-gate/types';
import type { GatewayConfigInput } from './gateway-config';

/**
 * Alles, was `buildGatewayConfig` ausser der App-Liste und der Domain braucht.
 * Die Domain steht als `appsDomain` schon im Kontext.
 */
export type GatewaySettings = Omit<GatewayConfigInput, 'apps' | 'appsDomain'>;

export interface DomainContext {
  readonly apps: AppRepository;
  readonly deployments: DeploymentRepository;
  readonly grants: GrantRepository;
  /**
   * Gruppen und Mitgliedschaften. Sie liegen hier und nicht im SSO-Token:
   * Google liefert ohne Workspace-Admin-SDK keine Gruppen, und eine Freigabe
   * aus einem Token waere nicht widerrufbar (Migration 0009).
   */
  readonly groups: GroupRepository;
  readonly audit: AuditRepository;
  readonly agents: AgentIdentityRepository;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly backend: DeploymentBackend;
  /**
   * Wohin die eigene dynamische Gateway-Konfiguration geschrieben wird
   * (ADR 0008). Die Struktur erzeugt die Domaene selbst
   * (`domain/gateway-config.ts`); dieser Anschluss bringt sie auf den Host und
   * liest sie zurueck.
   */
  readonly gatewayConfig: GatewayConfigStore;
  /**
   * Die Werte, die der Konfigurations-Generator ausser den Apps braucht:
   * Forward-Auth-Adresse, Deny-Backend, Entrypoint, Zertifikats-Resolver und
   * die Control Plane selbst. Sie kommen aus der Env und nicht aus der
   * Datenbank — es sind Eigenschaften der Instanz, nicht einer App.
   */
  readonly gatewaySettings: GatewaySettings;
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
  /**
   * Ereignisse, Benachrichtigungen und Abonnements (ADR 0022). Fehlt der
   * Anschluss, scheitern die Plattform-Tools dafuer mit einem Fehler; nichts
   * wird ohne Pruefung angenommen oder gezeigt.
   */
  readonly events?: EventRepository;
  /**
   * Wer sich schon angemeldet hat (Better Auth). Fehlt er, faellt eine
   * Empfaenger-Angabe `user:<id>` weg und Freigaben auf eine Nutzer-Id zaehlen
   * beim Ableiten nicht: weniger Benachrichtigungen, nie mehr.
   */
  readonly users?: UserDirectory;
  /**
   * Verweise zwischen Apps (ADR 0023). Fehlt der Anschluss, scheitern
   * `set_refs` und `list_backlinks` mit einem Fehler; Aufloesen geht ohne ihn.
   */
  readonly refs?: RefRepository;
  /**
   * Modell-Anbieter aus der Env (ADR 0024). Fehlt der Anschluss oder ist
   * darin kein Chat- bzw. Embedding-Modell, antwortet jede Funktion dafuer
   * `not_configured` und ruft nichts auf.
   */
  readonly models?: ModelSetup;
  /**
   * Nutzungszeilen fuer die Tagesgrenzen. Fehlt er, ruft die Plattform kein
   * Modell auf: Ohne Zaehlung gibt es keine Grenze, und „unbegrenzt“ ist nie
   * der Default.
   */
  readonly modelUsage?: ModelUsageRepository;
  /** Profile der Plattform-Agents (ADR 0024 E). */
  readonly agentProfiles?: AgentProfileRepository;
  /** Laeufe der Plattform-Agents, zugleich ihre Warteschlange. */
  readonly agentRuns?: AgentRunRepository;
  /** Team-Gedaechtnis (ADR 0024 F). */
  readonly memories?: TeamMemoryStore;
}

export const systemClock: Clock = { now: () => new Date() };

export const uuidIds: IdGenerator = { next: () => globalThis.crypto.randomUUID() };
