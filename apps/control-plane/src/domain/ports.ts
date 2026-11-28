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
  DatabaseExtension,
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
  /**
   * Gleich beim Anlegen mitgeschrieben, damit der Eintrag in einem Schritt
   * vollstaendig ist — es gibt keinen Zwischenstand „registriert, aber ohne
   * Domain" (ADR 0012).
   */
  readonly primaryDomain?: string | null;
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
  /**
   * Sperrt die Identitaet. Danach liefern `findByClientId` und `secretHashOf`
   * nichts mehr — die Anmeldung scheitert beim naechsten Aufruf.
   */
  disable(name: string, at: Date): Promise<AgentIdentity>;
  list(): Promise<readonly AgentIdentity[]>;
}

/* -------------------------------------------------------------------------- */
/* Ereignisse, Benachrichtigungen, Abonnements (ADR 0022)                      */
/* -------------------------------------------------------------------------- */

export type EventImportance = 'high' | 'normal' | 'low';

/** Ein angenommenes Ereignis (Migration 0017). */
export interface StoredEvent {
  /** Fortlaufende Nummer der Plattform; Cursor der Abonnements. */
  readonly seq: number;
  /** Name der Quell-App. */
  readonly app: string;
  /** Die Id, die die App vergeben hat. Eindeutig je App. */
  readonly eventId: string;
  /** Typ ohne App-Namen, wie im Manifest: `task.assigned`. */
  readonly type: string;
  readonly object: string;
  readonly title: string;
  readonly path: string;
  readonly actor: string | null;
  readonly audience: readonly string[];
  readonly importance: EventImportance;
  readonly occurredAt: Date;
  readonly receivedAt: Date;
}

export type NewEvent = Omit<StoredEvent, 'seq' | 'receivedAt'>;

/**
 * Wessen Eingang: ein Mensch ueber seine **E-Mail** (wie die Gruppen,
 * Migration 0009: auch vor dem ersten Login adressierbar) oder ein Agent
 * ueber seinen Namen. Apps haben keinen Eingang.
 */
export interface InboxOwner {
  readonly kind: 'human' | 'agent';
  readonly id: string;
}

export interface NotificationRecipient extends InboxOwner {
  /** Direkt adressiert oder ueber eine Gruppe; ordnet den Eingang. */
  readonly via: 'direct' | 'group';
  readonly viaGroup: string | null;
}

export type NotificationState = 'unread' | 'read' | 'done';

export interface InboxRow {
  readonly id: string;
  readonly state: NotificationState;
  readonly via: 'direct' | 'group';
  readonly viaGroup: string | null;
  readonly createdAt: Date;
  readonly event: StoredEvent;
}

export interface InboxQuery {
  readonly owner: InboxOwner;
  /** Nur diese Quell-Apps. Leer heisst: nichts (die Rechtepruefung liegt davor). */
  readonly apps: readonly string[];
  readonly states: readonly NotificationState[];
  readonly limit: number;
}

export interface EventSubscriptionRef {
  readonly app: string;
  readonly type: string;
}

export interface EventRepository {
  /** Gibt es dieses Ereignis der App schon? */
  exists(app: string, eventId: string): Promise<boolean>;
  /**
   * Legt das Ereignis und die Benachrichtigungen **in einer Transaktion** an.
   * `null`, wenn die App diese Id schon gemeldet hat (Doppel): Dann entsteht
   * auch keine Benachrichtigung.
   */
  insert(
    event: NewEvent,
    recipients: readonly NotificationRecipient[],
  ): Promise<StoredEvent | null>;
  /** Die Quell-Apps im Eingang, ohne Rechtepruefung (die macht die Domaene). */
  inboxApps(owner: InboxOwner): Promise<readonly string[]>;
  /** Zuerst direkt, dann nach Wichtigkeit, dann neueste zuerst. */
  listInbox(query: InboxQuery): Promise<readonly InboxRow[]>;
  countInbox(owner: InboxOwner, apps: readonly string[], state: NotificationState): Promise<number>;
  /** Setzt den Zustand nur auf Zeilen dieses Eingangs aus diesen Apps. Gibt die Zahl zurueck. */
  markInbox(
    owner: InboxOwner,
    ids: readonly string[],
    apps: readonly string[],
    state: NotificationState,
    at: Date,
  ): Promise<number>;
  /** Ereignisse der Abonnements nach ihrem Cursor, nach `seq` geordnet. */
  pollEvents(input: {
    readonly subscriber: string;
    readonly subscriptions: readonly EventSubscriptionRef[];
    readonly limit: number;
  }): Promise<readonly StoredEvent[]>;
  /** Setzt den Cursor dieser Abonnements auf mindestens `upTo`. Gibt die Zahl zurueck. */
  ackEvents(input: {
    readonly subscriber: string;
    readonly subscriptions: readonly EventSubscriptionRef[];
    readonly upTo: number;
    readonly at: Date;
  }): Promise<number>;
  /** Hoechste vergebene Nummer, 0 ohne Ereignis. */
  maxSeq(): Promise<number>;
  /** Hartes Loeschen nach der Frist (ADR 0022 F). Benachrichtigungen gehen mit. */
  purgeReceivedBefore(cutoff: Date): Promise<{ events: number; notifications: number }>;
}

/* -------------------------------------------------------------------------- */
/* Verweise zwischen Apps (ADR 0023)                                           */
/* -------------------------------------------------------------------------- */

export type StoredRefKind = 'mention' | 'link' | 'derived';

/** Ein Ziel einer Quelle, wie es gespeichert wird (Migration 0020). */
export interface StoredRefTarget {
  readonly ref: string;
  readonly kind: StoredRefKind;
  /** App des Ziels bei Objekten, `null` bei Subjekten. */
  readonly targetApp: string | null;
}

/** Ein eingehender Verweis: wer auf das Ziel zeigt. */
export interface IncomingRef {
  readonly source: string;
  readonly sourceApp: string;
  readonly kind: StoredRefKind;
  /** Stand der Quelle laut App. */
  readonly updatedAt: Date;
}

export type ReplaceRefsOutcome =
  | { readonly status: 'stale' }
  | {
      readonly status: 'applied';
      /** Die Menge vor dieser Meldung, fuer die neuen Erwaehnungen. */
      readonly previous: readonly StoredRefTarget[];
    };

export interface RefRepository {
  /**
   * Ersetzt die Menge der Quelle **in einer Transaktion**, wenn `updatedAt`
   * nicht aelter ist als der gespeicherte Stand; sonst `stale` und nichts
   * aendert sich. Eine leere Menge loescht alle Ziele, der Stand bleibt.
   */
  replace(input: {
    readonly source: string;
    readonly app: string;
    readonly updatedAt: Date;
    readonly targets: readonly StoredRefTarget[];
  }): Promise<ReplaceRefsOutcome>;
  /** Eingehende Verweise auf ein Ziel, neueste Quelle zuerst. Ohne Rechtepruefung. */
  listIncoming(target: string, limit: number): Promise<readonly IncomingRef[]>;
  /** Ausgehende Verweise einer Quelle. Fuer Tests und den lokalen Betrieb. */
  listOutgoing(source: string): Promise<readonly StoredRefTarget[]>;
}

/**
 * Die Personen, die sich schon einmal angemeldet haben (Better Auth,
 * Migration 0008). Nur lesen: Eine Empfaenger-Angabe `user:<id>` braucht die
 * E-Mail, eine E-Mail braucht fuer die Rechtepruefung die Nutzer-Id.
 */
export interface DirectoryUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
}

export interface UserDirectory {
  findById(id: string): Promise<DirectoryUser | null>;
  findByEmail(email: string): Promise<DirectoryUser | null>;
}

/* -------------------------------------------------------------------------- */
/* Modell-Anbieter (ADR 0024, implementiert von src/adapters/models)            */
/* -------------------------------------------------------------------------- */

export type ModelProviderKind = 'anthropic' | 'gemini' | 'openai-compatible';

/** Ein Tool, wie das Modell es angeboten bekommt. `inputSchema` ist JSON Schema. */
export interface ChatToolSpec {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export interface ChatToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
  /** Der Anbieter lieferte Argumente, die kein JSON-Objekt sind. Dann wird nichts ausgefuehrt. */
  readonly argumentsError?: string;
}

export interface ChatToolResult {
  readonly callId: string;
  readonly name: string;
  readonly content: string;
  readonly isError: boolean;
}

/**
 * Eine Nachricht im Verlauf, unabhaengig vom Anbieter. `raw` haelt die
 * Antwort des Anbieters unveraendert fuer die naechste Runde (etwa
 * Signaturen von Gedankengaengen bei Gemini); nur der Adapter desselben
 * Anbieters liest es, gespeichert wird es nie.
 */
export type ChatMessage =
  | { readonly role: 'user'; readonly content: string }
  | {
      readonly role: 'assistant';
      readonly content: string;
      readonly toolCalls: readonly ChatToolCall[];
      readonly raw?: { readonly provider: ModelProviderKind; readonly value: unknown };
    }
  | { readonly role: 'tool'; readonly results: readonly ChatToolResult[] };

export interface ChatRequest {
  readonly model: string;
  readonly system?: string;
  readonly messages: readonly ChatMessage[];
  readonly tools?: readonly ChatToolSpec[];
  readonly maxOutputTokens: number;
  readonly signal?: AbortSignal;
}

export interface ModelTokenCount {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface ChatResponse {
  readonly text: string;
  readonly toolCalls: readonly ChatToolCall[];
  readonly stopReason: 'end' | 'tool_use' | 'max_tokens' | 'other';
  readonly usage: ModelTokenCount;
  /** Die rohe Antwort fuer `ChatMessage.raw`, nur fuer diesen Anbieter. */
  readonly raw?: unknown;
}

export interface EmbedRequest {
  readonly model: string;
  readonly texts: readonly string[];
  /** Nur wenn `OPENAPPS_EMBEDDING_DIMENSIONS` gesetzt ist. */
  readonly dimensions: number | null;
  readonly signal?: AbortSignal;
}

export interface EmbedResponse {
  /** In der Reihenfolge von `texts`. */
  readonly vectors: readonly (readonly number[])[];
  readonly usage: ModelTokenCount;
}

/**
 * Der Port fuer einen Anbieter: `chat` und getrennt `embed`. Ein Adapter,
 * der eines davon nicht kann (Anthropic hat keine Embeddings), wirft. Der
 * Schluessel steckt im Adapter und verlaesst ihn nie, auch nicht in einer
 * Fehlermeldung.
 */
export interface ModelProvider {
  readonly kind: ModelProviderKind;
  /**
   * Lokal im Sinne von ADR 0024 C2: nur `openai-compatible` mit einer
   * Basis-URL auf Loopback, privater Adresse oder einem Namen ohne Punkt.
   */
  readonly local: boolean;
  chat(request: ChatRequest): Promise<ChatResponse>;
  embed(request: EmbedRequest): Promise<EmbedResponse>;
}

export interface ConfiguredModel {
  readonly provider: ModelProvider;
  /** Modellname aus der Env. Es gibt keinen Default. */
  readonly model: string;
}

export interface ConfiguredEmbeddingModel extends ConfiguredModel {
  readonly dimensions: number | null;
}

export interface ModelLimits {
  /** Tokens je UTC-Tag fuer die ganze Installation. */
  readonly dailyTokens: number;
  /** Tokens je UTC-Tag und Subjekt. */
  readonly dailyTokensPerSubject: number;
}

/**
 * Was die Env an Modellen hergibt. Fehlt `chat` oder `embedding`, antwortet
 * jede Funktion dafuer `not_configured`. `problems` nennt, was an der Env
 * nicht stimmt, ohne einen Wert daraus.
 */
export interface ModelSetup {
  readonly chat: ConfiguredModel | null;
  readonly embedding: ConfiguredEmbeddingModel | null;
  readonly limits: ModelLimits;
  /** `OPENAPPS_MODEL_LOCAL_ONLY_APPS`: Inhalte dieser Apps gehen nie an einen externen Anbieter. */
  readonly localOnlyApps: readonly string[];
  readonly problems: readonly string[];
}

export type ModelPurpose = 'agent_run' | 'summary' | 'answer' | 'generate' | 'embedding';
export type ModelCallOutcome = 'ok' | 'error' | 'budget_exceeded';

/** Eine Zeile in `model_usage` (Migration 0021). Kein Prompt, keine Antwort. */
export interface ModelUsageRow {
  readonly occurredAt: Date;
  readonly subject: SubjectRef;
  readonly purpose: ModelPurpose;
  readonly kind: 'chat' | 'embedding';
  readonly provider: ModelProviderKind;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly durationMs: number;
  readonly outcome: ModelCallOutcome;
  readonly runId: string | null;
}

export interface ModelUsageRepository {
  append(row: ModelUsageRow): Promise<void>;
  /** Summe aus Tokens ein und aus seit `since`; mit `subject` nur fuer dieses. */
  tokensSince(since: Date, subject?: SubjectRef): Promise<number>;
}

/* -------------------------------------------------------------------------- */
/* Plattform-Agents und ihre Laeufe (ADR 0024 E)                                */
/* -------------------------------------------------------------------------- */

export interface AgentProfile {
  readonly agentName: string;
  readonly instructions: string;
  /** Anderes Modell desselben Chat-Anbieters, sonst `null` (Modell aus der Env). */
  readonly model: string | null;
  readonly maxSteps: number;
  /** Hoechstens so viele Tokens je Lauf. */
  readonly tokenBudget: number;
  readonly updatedBy: string;
  readonly updatedAt: Date;
}

export type NewAgentProfile = Omit<AgentProfile, 'updatedAt'>;

export interface AgentProfileRepository {
  upsert(profile: NewAgentProfile): Promise<AgentProfile>;
  find(agentName: string): Promise<AgentProfile | null>;
  list(): Promise<readonly AgentProfile[]>;
}

export type AgentRunStatus = 'queued' | 'running' | 'succeeded' | 'failed';
export type AgentRunTriggerKind = 'manual' | 'mention';

/**
 * Wer den Lauf ausgeloest hat. Seine Freigaben schneiden die des Agenten
 * (ADR 0024 E). Ein Mensch mit seiner E-Mail, damit seine Gruppen bei jeder
 * Pruefung frisch gelesen werden.
 */
export interface AgentRunTrigger {
  readonly kind: 'user' | 'agent';
  readonly id: string;
  readonly email: string | null;
}

/** Ein Tool-Aufruf im Lauf, ohne Argumente und ohne Ergebnis. */
export interface AgentRunToolCall {
  readonly tool: string;
  readonly ok: boolean;
  readonly at: string;
}

export interface AgentRun {
  readonly id: string;
  readonly agentName: string;
  readonly status: AgentRunStatus;
  readonly triggerKind: AgentRunTriggerKind;
  readonly trigger: AgentRunTrigger;
  /** Bei einer Erwaehnung: das Objekt, in dem sie stand, seine App und sein Pfad. */
  readonly source: string | null;
  readonly sourceApp: string | null;
  readonly sourcePath: string | null;
  readonly prompt: string;
  readonly result: string | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly steps: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Herkunft: Apps, deren Inhalte der Lauf gesehen hat (ADR 0024 F). Waechst nur. */
  readonly usedApps: readonly string[];
  readonly toolCalls: readonly AgentRunToolCall[];
  readonly createdAt: Date;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly leaseUntil: Date | null;
}

export interface NewAgentRun {
  readonly agentName: string;
  readonly triggerKind: AgentRunTriggerKind;
  readonly trigger: AgentRunTrigger;
  readonly source: string | null;
  readonly sourceApp: string | null;
  readonly sourcePath: string | null;
  readonly prompt: string;
  readonly usedApps: readonly string[];
  /** Schutz gegen Doppel (eine Erwaehnung startet genau einen Lauf). */
  readonly dedupeKey: string | null;
}

export interface AgentRunPatch {
  readonly status?: AgentRunStatus;
  readonly result?: string | null;
  readonly errorCode?: string | null;
  readonly errorMessage?: string | null;
  readonly steps?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly usedApps?: readonly string[];
  readonly toolCalls?: readonly AgentRunToolCall[];
  readonly startedAt?: Date;
  readonly finishedAt?: Date;
  readonly leaseUntil?: Date | null;
}

export interface AgentRunRepository {
  /** `null`, wenn es zu `dedupeKey` schon einen Lauf gibt. */
  create(run: NewAgentRun): Promise<AgentRun | null>;
  findById(id: string): Promise<AgentRun | null>;
  /**
   * Laeufe, die von `triggeredBy` ausgeloest wurden **oder** zu einem der
   * Agents in `agentNames` gehoeren, neueste zuerst. Ohne Rechtepruefung.
   */
  list(filter: {
    readonly triggeredBy?: { readonly kind: 'user' | 'agent'; readonly id: string };
    readonly agentNames?: readonly string[];
    readonly limit: number;
  }): Promise<readonly AgentRun[]>;
  /** Nimmt den aeltesten wartenden Lauf und setzt ihn auf `running`, atomar. */
  claimNext(input: { readonly now: Date; readonly leaseUntil: Date }): Promise<AgentRun | null>;
  update(id: string, patch: AgentRunPatch): Promise<AgentRun>;
  /** Laeufe in `running`, deren Frist vor `now` endete, werden `failed`. Gibt die Zahl zurueck. */
  failExpired(now: Date, errorCode: string, errorMessage: string): Promise<number>;
}

/* -------------------------------------------------------------------------- */
/* Team-Gedaechtnis (ADR 0024 F)                                               */
/* -------------------------------------------------------------------------- */

export interface MemoryEntry {
  readonly id: string;
  /** Wer es sich gemerkt hat: ein Agent. */
  readonly author: string;
  readonly text: string;
  /** Herkunft: alle Apps, deren Inhalte zu diesem Eintrag beitrugen. Sortiert. */
  readonly apps: readonly string[];
  readonly runId: string | null;
  readonly createdAt: Date;
}

export type NewMemoryEntry = Omit<MemoryEntry, 'id' | 'createdAt'>;

/**
 * Der Speicher hinter dem Gedaechtnis. Zuerst Postgres (Migration 0024);
 * eine zweite Implementierung (cognee, ADR 0024 F) bekommt dieselben
 * Argumente. **`readableApps` ist Pflicht**: Ein Speicher liefert nur
 * Eintraege, deren Herkunft ganz darin liegt, und die Domaene prueft das
 * Ergebnis noch einmal.
 */
export interface TeamMemoryStore {
  remember(entry: NewMemoryEntry): Promise<MemoryEntry>;
  recall(input: {
    readonly query: string;
    readonly readableApps: readonly string[];
    readonly limit: number;
  }): Promise<readonly MemoryEntry[]>;
  list(input: {
    readonly authors?: readonly string[];
    readonly readableApps: readonly string[];
    readonly limit: number;
  }): Promise<readonly MemoryEntry[]>;
  findById(id: string): Promise<MemoryEntry | null>;
  /** Hartes Loeschen. `false`, wenn es den Eintrag nicht gab. */
  forget(id: string): Promise<boolean>;
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
  /**
   * Setzt die Env einer **frisch angelegten** App vollstaendig. Nur direkt
   * nach `createApp` aufrufen.
   */
  setEnv(backendRef: string, env: Readonly<Record<string, string>>): Promise<void>;
  /**
   * Zieht die Env einer **bestehenden** App nach (ADR 0020): Schluessel, die
   * fehlen oder einen anderen Wert haben, werden gesetzt; alle anderen
   * bleiben, wie sie sind — auch solche, die `env` nicht nennt (etwa
   * `DATABASE_URL`). Nichts wird entfernt. Ein zweiter Aufruf mit derselben
   * Env aendert nichts und scheitert nicht. Wirft, wenn ein Schluessel nicht
   * gesetzt werden konnte.
   */
  mergeEnv(backendRef: string, env: Readonly<Record<string, string>>): Promise<void>;
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
  /**
   * Holt genau einen Commit als Arbeitskopie auf die Platte der Control Plane,
   * damit die Scanner des Review-Gates darauf laufen koennen. Ohne das muesste
   * der Aufrufer einen Pfad auf dem Server kennen — und ein Agent, der ueber
   * MCP deployt, hat keinen.
   */
  checkout(input: RepositoryCheckoutRequest): Promise<RepositoryCheckout>;
}

export interface RepositoryCheckoutRequest {
  /** Die Git-URL aus dem Register (`app.source.git`), nie eine vom Aufrufer. */
  readonly gitUrl: string;
  readonly gitSha: string;
}

export interface RepositoryCheckout {
  /** Verzeichnis mit dem Stand des Commits, ohne `.git`. */
  readonly dir: string;
  /** Raeumt das Verzeichnis weg. Darf mehrfach gerufen werden. */
  dispose(): Promise<void>;
}

/** Legt Schema und DB-Rolle an (ruft provision_app_schema aus Migration 0006). */
export interface SchemaProvisioner {
  provision(input: { schemaName: string; dbRole: string }): Promise<{ dsn: string }>;
  /**
   * Gleicht den Zugang der App-Rolle zum Schema `extensions` mit dem Manifest
   * ab (ADR 0025, Migration 0025): mit Bedarf `USAGE`, ohne Bedarf keines,
   * nie `CREATE`. Fehlt eine Erweiterung, wirft es
   * `MissingDatabaseExtensionError`; die Domaene beendet den Deploy dann als
   * `failed`.
   */
  syncExtensions(input: {
    dbRole: string;
    extensions: readonly DatabaseExtension[];
  }): Promise<void>;
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
