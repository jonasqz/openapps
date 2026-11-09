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

/* ----------------------------- Label-Lint --------------------------------- */

/**
 * Die App, wie das Gateway sie sieht: Name, Domain, Port. Neutral gehalten —
 * kein Traefik- und kein Coolify-Begriff.
 */
export interface GatewayTarget {
  readonly appName: string;
  readonly domain: string;
  readonly port: number;
}

/**
 * Was das Backend fuer eine App ans Gateway geben wuerde, aufgeschluesselt in
 * die Teile, auf die es ankommt.
 *
 * Warum nicht einfach die rohen Labels: Die Namen der Label-Schluessel sind
 * Traefik-Vokabular und gehoeren in den Adapter. Die **Bedeutung** — laeuft
 * eine Forward-Auth davor, werden mitgeschickte Identitaets-Header entfernt,
 * steht der Port drin — gehoert in die Domaene, weil nur sie beurteilen kann,
 * ob das reicht. Der Adapter uebersetzt, die Domaene urteilt.
 */
export interface GatewayLabelPlan {
  /** Der vollstaendige Satz, wie er ans Backend ginge. Fuer den Nachweis. */
  readonly labels: Readonly<Record<string, string>>;
  /** Port, den das Gateway fuer den Dienst benutzt, als Zeichenkette wie im Label. */
  readonly servicePort: string | undefined;
  /** Adresse, die die Forward-Auth pro Aufruf fragt. */
  readonly forwardAuthAddress: string | undefined;
  /** Die Host-Regel des Routers, z. B. ``Host(`app.example.com`)``. */
  readonly hostRule: string | undefined;
  /** Middleware-Kette des Routers, in Reihenfolge. */
  readonly middlewares: readonly string[];
  /**
   * `true`, wenn die Kette eine Middleware enthaelt, die die `X-Auth-*`-Header
   * der **Anfrage** loescht, und diese **vor** der Forward-Auth steht.
   */
  readonly stripsIdentityHeaders: boolean;
  /** `true`, wenn die Kette eine Forward-Auth enthaelt. */
  readonly forwardsAuth: boolean;
}

/**
 * Der Label-Lint aus Spec Woche 1, Abschnitt 1 (Baustein „Label-Lint", „vor und
 * nach jedem Deploy"). Zwei Richtungen, beide noetig:
 *
 * - `plan` — was wuerden wir setzen? Das ist eine **Ableitung** und laeuft vor
 *   dem Deploy. Sie faengt den Fall, dass die Ableitung schon scheitert.
 * - `missing` — was fehlt an einem **gemessenen** Satz? Das laeuft nach dem
 *   Deploy gegen die Labels, die wirklich am Container stehen, und ist der
 *   Teil, der etwas beweist.
 */
export interface GatewayLabelLint {
  plan(target: GatewayTarget): GatewayLabelPlan;
  /** Fehlende oder abweichende Label-Schluessel. Leer heisst vollstaendig. */
  missing(actual: Readonly<Record<string, string>>, target: GatewayTarget): readonly string[];
}

/**
 * Das Ergebnis des Zuruecklesens. Drei Zustaende waeren zwei zu wenig: „nicht
 * erreichbar" ist **kein** Befund ueber die Labels (dasselbe Muster wie
 * `src/infra/gateway-guard.ts`). Wer daraus einen Befund macht, hat beim
 * ersten Netzwerkfehler einen Alarm, den niemand mehr liest.
 */
export type GatewayLabelReading =
  | { readonly state: 'read'; readonly labels: Readonly<Record<string, string>> }
  | { readonly state: 'unreachable'; readonly reason: string };

/* -------------------------------- Alarme ---------------------------------- */

/**
 * Ein Zustand, der laut ist, aber nichts abbricht. Gegenstueck zum
 * Prozess-Alarm in `src/infra/gateway-guard.ts`: Die Domaene kennt nur diesen
 * Satz, wo der Alarm landet (Log, `/healthz`) entscheidet die Infrastruktur.
 */
export interface PlatformAlarm {
  /** Stabiler Bezeichner, z. B. 'gateway_labels'. */
  readonly kind: string;
  /** Worueber der Alarm geht, z. B. `app:projektliste`. */
  readonly subject: string;
  readonly problems: readonly string[];
}

export interface AlarmSink {
  raise(alarm: PlatformAlarm): void;
  clear(kind: string, subject: string): void;
}

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
  /**
   * Liest zurueck, welche Gateway-Labels an dieser App stehen — nach dem
   * Deploy, als Messung und nicht als Ableitung (Spec Woche 1, Abschnitt 1:
   * Label-Lint „vor und nach jedem Deploy").
   *
   * Der Rueckgabewert unterscheidet „gelesen" von „nicht erreichbar", weil die
   * Domaene aus dem zweiten Fall **keinen** Befund machen darf. Was der
   * Adapter dafuer anfaellt, ist seine Sache; die Domaene bekommt flache
   * Schluessel-Wert-Paare.
   */
  readGatewayLabels(backendRef: string): Promise<GatewayLabelReading>;
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
