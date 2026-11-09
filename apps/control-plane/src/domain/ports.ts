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
  Group,
  GroupMember,
  ManifestSource,
  ResourceRef,
  ReviewDecision,
  SubjectRef,
  Verb,
} from './types';
import type { GatewayDynamicConfig } from './gateway-config';

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

/**
 * Gruppen und ihre Mitglieder (Migration 0009). **Kein Cache**, auf keiner
 * Ebene: `groupsFor` laeuft bei jedem Forward-Auth-Aufruf, und ein Widerruf,
 * der erst nach einer Frist wirkt, ist kein Widerruf (DoD 3).
 */
export interface GroupRepository {
  /** Wirft `ConflictError`, wenn es die Gruppe schon gibt. */
  create(group: { name: string; description: string }): Promise<Group>;
  findByName(name: string): Promise<Group | null>;
  /** Alle Gruppen, alphabetisch. Die Rechtepruefung passiert in der Domaene. */
  listAll(): Promise<readonly Group[]>;
  /** Mitglieder einer Gruppe, alphabetisch nach E-Mail. */
  listMembers(group: string): Promise<readonly GroupMember[]>;
  /** Gruppen dieser Adresse, alphabetisch. Unbekannt heisst leer, nicht Fehler. */
  groupsFor(email: string): Promise<readonly string[]>;
  /** Idempotent: zweimal dieselbe Mitgliedschaft ist keine Aenderung. */
  ensureMembership(group: string, email: string, addedBy: string): Promise<void>;
  removeMembership(group: string, email: string): Promise<void>;
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
  /**
   * Der Netz-Alias, unter dem das Gateway den Container erreicht
   * (`naming.ts`, `gatewayAliasFor`). Keine Domain: Apps werden ohne Domain
   * deployt, damit das Backend ihnen keinen eigenen Router gibt (ADR 0008).
   */
  readonly networkAlias: string;
  /** Port, auf dem die App lauscht (`domain/app-port.ts`). */
  readonly port: number;
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

/* --------------------- Die eigene Gateway-Konfiguration -------------------- */

/**
 * Wohin die erzeugte Gateway-Konfiguration geschrieben wird und wie sie
 * zurueckgelesen wird (ADR 0008: `/data/coolify/proxy/dynamic/openapps.yaml`).
 *
 * Die Domaene erzeugt die Struktur (`domain/gateway-config.ts`), dieser
 * Anschluss bringt sie auf den Host. Wie — Dateisystem, SSH, API — entscheidet
 * die Infrastruktur (`infra/gateway-config-store.ts`).
 *
 * `verify` ist absichtlich hier und nicht in der Domaene: Der Vergleich
 * braucht die **Serialisierung**, und die kennt nur die Seite, die schreibt.
 * Die Domaene bekommt das Urteil in drei Zustaenden und entscheidet, was es
 * bedeutet.
 */
export interface GatewayConfigStore {
  /** Schreibt die Konfiguration. Ein Fehler wird geworfen, nicht geschluckt. */
  publish(config: GatewayDynamicConfig): Promise<void>;
  /**
   * Vergleicht, was wirklich auf dem Host liegt, mit der uebergebenen
   * Konfiguration. Das ist die Messung nach dem Deploy — das Gegenstueck zur
   * Ableitung vor dem Deploy.
   */
  verify(config: GatewayDynamicConfig): Promise<GatewayConfigVerification>;
}

/**
 * Drei Zustaende, nicht zwei. „Nicht lesbar" ist **kein** Befund ueber die
 * Konfiguration (dasselbe Muster wie `src/infra/gateway-guard.ts`): Wer daraus
 * einen Alarm macht, hat beim ersten Dateisystemfehler einen Alarm, den
 * niemand mehr liest.
 */
export type GatewayConfigVerification =
  | { readonly state: 'match' }
  | { readonly state: 'mismatch'; readonly problems: readonly string[] }
  | { readonly state: 'unreachable'; readonly reason: string };

/* ------------------- Was das Backend der App selbst gibt ------------------- */

/**
 * Was am Container der App haengt, nachdem das Deploy-Backend mit ihr fertig
 * ist. Unter ADR 0008 ist das eine **Negativ**-Messung: Hier darf nichts
 * stehen. Jede `traefik.*`-Label und jede Port-Veroeffentlichung waere ein
 * Weg an unserer Konfiguration und damit an der Forward-Auth vorbei.
 */
export interface AppGatewayFacts {
  /** Labels, die das Backend an dieser App fuehrt. Erwartet: keine `traefik.*`. */
  readonly labels: Readonly<Record<string, string>>;
  /**
   * Veroeffentlichte Host-Ports, wie das Backend sie fuehrt (Coolify:
   * `ports_mappings`). Erwartet: leer. Ein Host-Port macht den Container am
   * Gateway vorbei erreichbar und das Signatur-Modell aus Spec 3.2 wertlos.
   */
  readonly portsMappings: string;
  /** Domains, die das Backend der App gegeben hat. Erwartet: keine. */
  readonly domains: string;
}

export type AppGatewayFactsReading =
  | { readonly state: 'read'; readonly facts: AppGatewayFacts }
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
  /**
   * Legt die App im Backend an — **ohne Domain** und ohne eigenen Router
   * (ADR 0008). Der Adapter muss das ausdruecklich erzwingen; Coolifys API
   * erzeugt sonst von sich aus eine sslip.io-Domain samt Router ohne unsere
   * Middlewares (`ApplicationsController.php:1690`).
   */
  createApp(spec: BackendAppSpec): Promise<{ backendRef: string }>;
  setEnv(backendRef: string, env: Readonly<Record<string, string>>): Promise<void>;
  deploy(request: BackendDeployRequest): Promise<BackendDeployResult>;
  status(backendRef: string): Promise<BackendStatus>;
  /** Auf die genannte Version zurueck. Muss unter 2 Minuten liefern (DoD 5). */
  rollback(backendRef: string, gitSha: string): Promise<BackendDeployResult>;
  /**
   * Liest zurueck, was das Backend der App selbst gegeben hat — nach dem
   * Deploy, als Messung und nicht als Ableitung.
   *
   * Der Rueckgabewert unterscheidet „gelesen" von „nicht erreichbar", weil die
   * Domaene aus dem zweiten Fall **keinen** Befund machen darf.
   */
  readAppGatewayFacts(backendRef: string): Promise<AppGatewayFactsReading>;
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
