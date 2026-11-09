import type { AppManifest, ManifestSource } from '@openapps/app-manifest';

/**
 * Die Sprache des Rechtemodells. Diese Datei ist die Quelle der Wahrheit fuer
 * Subjekte, Verben und Ressourcen — HTTP, MCP und SQL benutzen dieselben Woerter.
 */

export type SubjectKind = 'user' | 'group' | 'app' | 'agent';

export interface SubjectRef {
  readonly kind: SubjectKind;
  readonly id: string;
}

/**
 * Der Aufrufer einer Domaenenfunktion. `groups` kommt beim Menschen aus dem
 * SSO; fuer App- und Agent-Subjekte ist es leer.
 */
export interface Actor extends SubjectRef {
  readonly groups?: readonly string[];
}

export type Verb = 'read' | 'write' | 'execute';

export type ResourceKind = 'app' | 'table' | 'view' | 'tool';

export interface ResourceRef {
  readonly kind: ResourceKind;
  /** Konkrete Id, oder '*' als Wildcard fuer alle Ressourcen dieser Art. */
  readonly id: string;
}

export const ANY = '*';

export interface Grant {
  readonly id: string;
  readonly subject: SubjectRef;
  readonly verb: Verb;
  readonly resource: ResourceRef;
  readonly grantedBy: string;
  readonly grantedAt: Date;
  readonly revokedAt: Date | null;
  readonly revokedBy: string | null;
}

export type DeploymentStatus =
  | 'pending'
  | 'reviewing'
  | 'blocked'
  | 'deploying'
  | 'live'
  | 'degraded'
  | 'superseded'
  | 'failed'
  | 'rolled_back';

export type ReviewDecision = 'pass' | 'blocked';

export interface Deployment {
  readonly id: string;
  readonly appId: string;
  readonly version: string;
  readonly gitSha: string;
  readonly status: DeploymentStatus;
  readonly reviewDecision: ReviewDecision | null;
  /** Vollstaendiges Ergebnis der Review-Pipeline, als JSON abgelegt. */
  readonly reviewResult: unknown;
  readonly backendRef: string | null;
  readonly requestedBy: string;
  readonly requestedAt: Date;
  readonly reviewedAt: Date | null;
  readonly deployedAt: Date | null;
}

export interface App {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  readonly category: string | null;
  readonly manifest: AppManifest;
  /** Git-URL und Tag, aus denen diese App gebaut wird. */
  readonly source: ManifestSource;
  readonly schemaName: string;
  readonly dbRole: string;
  readonly primaryDomain: string | null;
  /** Generation des abgeleiteten Gateway-Secrets (Migration 0007). */
  readonly authSecretGeneration: number;
  readonly currentDeploymentId: string | null;
  readonly previousDeploymentId: string | null;
  readonly archivedAt: Date | null;
  readonly createdBy: string;
  readonly createdAt: Date;
}

export type AuditOutcome = 'allowed' | 'denied' | 'error';

export interface AuditEntry {
  readonly occurredAt: Date;
  readonly actor: SubjectRef;
  /** Gleich benannt wie das MCP-Tool: 'create_app', 'grant', 'rollback', ... */
  readonly action: string;
  readonly resource: ResourceRef | null;
  readonly outcome: AuditOutcome;
  readonly reason: string | null;
  readonly detail: Readonly<Record<string, unknown>>;
  readonly correlationId: string | null;
}

export interface AgentIdentity {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  readonly oauthClientId: string;
  readonly ownerUserId: string;
  readonly createdAt: Date;
  readonly lastSeenAt: Date | null;
  readonly disabledAt: Date | null;
}

/* -------------------------------------------------------------------------- */
/* Manifest und Quelle — maßgeblich ist @openapps/app-manifest                 */
/* -------------------------------------------------------------------------- */

/**
 * Das Schema von `app.json` liegt in `@openapps/app-manifest` und nirgends
 * sonst. Hier stehen nur Re-Exporte, damit die Domaene eine Form benutzt und
 * nicht eine zweite beschreibt.
 *
 * **Nicht** uebernommen werden die Rechte-Typen des Pakets (`SubjectKind`,
 * `Verb`, `ResourceKind`, `ResourceRef`). Grund: das Paket nennt den Menschen
 * `human`, das Rechtemodell dieser Datenbank nennt ihn `user` (Migration
 * 0003, nicht mehr aenderbar). Die Uebersetzung steht in `manifest-grants.ts`
 * — eine Stelle, benannt, mit Test. Dass es sie ueberhaupt braucht, ist eine
 * offene Entscheidung fuer den CoS.
 */
export type {
  AppManifest,
  AppManifestInput,
  EgressTarget,
  EnvVar,
  ManifestSource,
  OfferedTool,
  RequestedGrant,
  RequiredTable,
} from '@openapps/app-manifest';
