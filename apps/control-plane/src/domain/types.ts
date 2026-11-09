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
  readonly source: CatalogSource;
  readonly schemaName: string;
  readonly dbRole: string;
  readonly primaryDomain: string | null;
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
/* Annahme ueber @openapps/app-manifest                                        */
/* -------------------------------------------------------------------------- */

/**
 * Erwartete Form von `app.json` aus `@openapps/app-manifest`. Die Typen stehen
 * hier strukturell, damit diese App unabhaengig vom Stand des Pakets
 * typechecken kann. Sobald `@openapps/app-manifest` liegt, wird diese Datei zu
 * einem Re-Export:
 *
 *   export type { AppManifest, CatalogSource } from '@openapps/app-manifest';
 *
 * Es gibt genau diese eine Stelle, die getauscht werden muss.
 */
export interface ManifestTable {
  readonly name: string;
  readonly description?: string | undefined;
}

export interface ManifestTool {
  readonly name: string;
  readonly description?: string | undefined;
  /** Verb, das der Aufruf des Tools auf der App braucht. */
  readonly verb?: Verb | undefined;
}

export interface ManifestPermissionRequest {
  readonly resourceKind: ResourceKind;
  readonly resourceId: string;
  readonly verb: Verb;
  readonly reason?: string | undefined;
}

/**
 * Optionale Felder stehen absichtlich als `?: T | undefined`: so passt ein
 * Objekt, das aus einem Schema-Parser kommt (und `undefined` ausdruecklich
 * mitfuehrt), auch unter `exactOptionalPropertyTypes` hierher.
 */
export interface AppManifest {
  readonly name: string;
  readonly displayName?: string | undefined;
  readonly description?: string | undefined;
  readonly category?: string | undefined;
  readonly version: string;
  readonly tables?: readonly ManifestTable[] | undefined;
  readonly tools?: readonly ManifestTool[] | undefined;
  readonly permissions?: readonly ManifestPermissionRequest[] | undefined;
  readonly env?: readonly string[] | undefined;
  readonly source?: CatalogSource | undefined;
}

export type CatalogSource =
  | { readonly kind: 'git'; readonly url: string; readonly ref?: string | undefined }
  | { readonly kind: 'local'; readonly path: string }
  | {
      readonly kind: 'catalog';
      readonly catalog: string;
      readonly id: string;
      readonly version?: string | undefined;
    };
