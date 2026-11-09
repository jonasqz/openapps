/**
 * Die Anschluesse der Domaene nach aussen. Alles, was die Domaene braucht und
 * nicht selbst ist, steht hier als Interface: Speicher, Uhr, Ids, Deploy-Backend,
 * Schema-Bereitstellung. Keine Implementierung, kein Anbietername.
 */

import type {
  AgentIdentity,
  App,
  AppManifest,
  AuditEntry,
  Deployment,
  DeploymentStatus,
  Grant,
  ManifestSource,
  ResourceRef,
  ReviewDecision,
  SubjectRef,
  Verb,
} from './types';

export interface NewApp {
  readonly name: string;
  readonly displayName: string;
  readonly category: string | null;
  readonly manifest: AppManifest;
  readonly source: ManifestSource;
  readonly schemaName: string;
  readonly dbRole: string;
  readonly createdBy: string;
}

export interface AppRepository {
  create(app: NewApp): Promise<App>;
  findById(id: string): Promise<App | null>;
  findByName(name: string): Promise<App | null>;
  /** Fuer die Forward-Auth: ein Treffer pro Aufruf, kein Durchlaufen der Liste. */
  findByDomain(domain: string): Promise<App | null>;
  /** Alle nicht archivierten Apps. Die Rechtepruefung passiert in der Domaene. */
  listAll(): Promise<readonly App[]>;
  setDeploymentPointers(
    appId: string,
    currentId: string | null,
    previousId: string | null,
  ): Promise<void>;
  setPrimaryDomain(appId: string, domain: string): Promise<void>;
  setManifest(appId: string, manifest: AppManifest): Promise<void>;
}

export interface NewDeployment {
  readonly appId: string;
  readonly version: string;
  readonly gitSha: string;
  readonly requestedBy: string;
}

export interface DeploymentPatch {
  readonly status?: DeploymentStatus;
  readonly reviewDecision?: ReviewDecision;
  readonly reviewResult?: unknown;
  readonly backendRef?: string;
  readonly reviewedAt?: Date;
  readonly deployedAt?: Date;
}

export interface DeploymentRepository {
  create(deployment: NewDeployment): Promise<Deployment>;
  findById(id: string): Promise<Deployment | null>;
  /** Neueste zuerst. */
  listByApp(appId: string): Promise<readonly Deployment[]>;
  patch(id: string, patch: DeploymentPatch): Promise<Deployment>;
}

export interface NewGrant {
  readonly subject: SubjectRef;
  readonly verb: Verb;
  readonly resource: ResourceRef;
  readonly grantedBy: string;
}

export interface GrantLookup {
  /** Subjekt und alle seine Gruppen — der Treffer darf aus jedem davon kommen. */
  readonly subjects: readonly SubjectRef[];
  readonly verb: Verb;
  readonly resource: ResourceRef;
}

export interface GrantRepository {
  insert(grant: NewGrant): Promise<Grant>;
  /**
   * Alle offenen (nicht widerrufenen) Freigaben, die auf die Anfrage passen.
   * Wildcard-Ressourcen ('*') zaehlen als Treffer. Diese Methode darf nicht
   * cachen — Widerruf muss sofort wirken (DoD 3).
   */
  findActive(lookup: GrantLookup): Promise<readonly Grant[]>;
  findActiveById(id: string): Promise<Grant | null>;
  findActiveMatching(match: Omit<NewGrant, 'grantedBy'>): Promise<Grant | null>;
  revoke(id: string, revokedBy: string, revokedAt: Date): Promise<Grant>;
  listForSubjects(subjects: readonly SubjectRef[]): Promise<readonly Grant[]>;
  listForResource(resource: ResourceRef): Promise<readonly Grant[]>;
  /** Alle Freigaben, neueste zuerst — inklusive widerrufener (Audit-Sicht). */
  listAll(limit: number): Promise<readonly Grant[]>;
}

export interface AuditRepository {
  /** Append-only. Es gibt absichtlich kein update und kein delete. */
  append(entry: AuditEntry): Promise<void>;
  list(limit: number): Promise<readonly AuditEntry[]>;
}

export interface NewAgentIdentity {
  readonly name: string;
  readonly displayName: string;
  readonly ownerUserId: string;
  readonly oauthClientId: string;
  readonly oauthClientSecretHash: string;
}

export interface AgentIdentityRepository {
  create(identity: NewAgentIdentity): Promise<AgentIdentity>;
  findByName(name: string): Promise<AgentIdentity | null>;
  findByClientId(clientId: string): Promise<AgentIdentity | null>;
  /** Hash des Secrets, um ihn zu pruefen; nie das Secret selbst. */
  secretHashOf(clientId: string): Promise<string | null>;
  touch(clientId: string, at: Date): Promise<void>;
  list(): Promise<readonly AgentIdentity[]>;
}

/* -------------------------------------------------------------------------- */
/* Deploy-Backend (implementiert von src/adapters/coolify)                      */
/* -------------------------------------------------------------------------- */

export interface BackendAppSpec {
  readonly appName: string;
  readonly gitUrl: string;
  readonly gitRef: string;
  readonly domain: string;
}

export interface BackendDeployRequest {
  readonly backendRef: string;
  readonly gitSha: string;
}

export interface BackendDeployResult {
  readonly backendRef: string;
  readonly ok: boolean;
  readonly message?: string;
}

export type BackendStatus = 'unknown' | 'building' | 'running' | 'stopped' | 'failed';

/**
 * Was die Control Plane von einem Deploy-Backend braucht. Die Begriffe sind
 * absichtlich neutral: hinter diesem Interface laesst sich Coolify austauschen,
 * ohne dass die Domaene es merkt (Abbruchpfad aus dem Brief).
 */
export interface DeploymentBackend {
  createApp(spec: BackendAppSpec): Promise<{ backendRef: string }>;
  setEnv(backendRef: string, env: Readonly<Record<string, string>>): Promise<void>;
  deploy(request: BackendDeployRequest): Promise<BackendDeployResult>;
  status(backendRef: string): Promise<BackendStatus>;
  /** Auf die genannte Version zurueck. Muss unter 2 Minuten liefern (DoD 5). */
  rollback(backendRef: string, gitSha: string): Promise<BackendDeployResult>;
  setDomain(backendRef: string, domain: string): Promise<void>;
  /**
   * Stellt die App hinter das Gateway, sodass jeder Aufruf durch die
   * Forward-Auth laeuft. Die Domaene uebergibt Name, Domain und den Port, auf
   * dem die App lauscht — wie das beim Backend aussieht (Labels, Middleware,
   * Router, Dienst), weiss der Adapter. Ohne diesen Schritt gibt es keinen
   * Deploy (DoD 2).
   *
   * `port` steht hier, weil das Gateway ohne ihn nur raten kann: Traefik faellt
   * sonst auf das `EXPOSE` des Images zurueck und bekommt bei keinem oder
   * mehreren `EXPOSE` keinen Dienst zusammen. Woher der Wert kommt, steht in
   * `domain/app-port.ts`.
   */
  ensureGateway(
    backendRef: string,
    spec: { appName: string; domain: string; port: number },
  ): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/* Repo-Backend (implementiert von src/adapters/github)                         */
/* -------------------------------------------------------------------------- */

export interface NewRepositorySpec {
  /** App-Name; wird der Repo-Name. */
  readonly appName: string;
  readonly description: string;
  /** Wer das Anlegen angefordert hat — landet in der Commit-/Audit-Spur. */
  readonly requestedBy: string;
}

export interface CreatedRepository {
  /** Klonbare URL, wie sie ins Manifest und ins Deploy-Backend geht. */
  readonly gitUrl: string;
  /** Tag oder Startpunkt, auf dem das neue Repo steht. */
  readonly tag: string;
  /** Mensch-lesbare Adresse zum Nachsehen. Kein Teil des Vertrags. */
  readonly webUrl?: string;
}

/**
 * Woher ein neues App-Repo kommt. Die Domaene kennt genau einen Satz:
 * „lege ein Repo aus dem Starter-Template an und gib mir seine Git-URL".
 * Welcher Anbieter das tut, steht nur im Adapter — dasselbe Muster wie beim
 * `DeploymentBackend`, aus demselben Grund (Austauschbarkeit).
 */
export interface RepositoryBackend {
  createFromTemplate(spec: NewRepositorySpec): Promise<CreatedRepository>;
}

/** Legt Schema und DB-Rolle an (ruft provision_app_schema aus Migration 0006). */
export interface SchemaProvisioner {
  provision(input: { schemaName: string; dbRole: string }): Promise<{ dsn: string }>;
  /** Freigabe zwischen Apps auf Postgres-Ebene durchsetzen. */
  grantSelect(input: { grantee: string; schemaName: string; objectName: string }): Promise<void>;
  revokeSelect(input: { grantee: string; schemaName: string; objectName: string }): Promise<void>;
}

/* -------------------------------------------------------------------------- */

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}
