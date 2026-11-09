/**
 * Speicher im Prozess. Zweck: die Domaenenlogik testbar machen, ohne eine
 * Datenbank zu brauchen. Die Semantik ist absichtlich dieselbe wie in SQL —
 * besonders bei den Freigaben, wo `grantMatches` aus der Domaene benutzt wird,
 * damit In-Memory und Postgres nicht auseinanderlaufen.
 *
 * Nicht fuer den Betrieb. Dort laeuft `src/infra/pg`.
 */

import { grantMatches } from '../../domain/can';
import { ConflictError, NotFoundError } from '../../domain/errors';
import type {
  AgentIdentityRepository,
  AppRepository,
  AuditRepository,
  DeploymentPatch,
  DeploymentRepository,
  GrantLookup,
  GrantRepository,
  GroupRepository,
  NewAgentIdentity,
  NewApp,
  NewDeployment,
  NewGrant,
} from '../../domain/ports';
import type {
  AgentIdentity,
  App,
  AuditEntry,
  Deployment,
  Grant,
  Group,
  GroupMember,
  ResourceRef,
  SubjectRef,
} from '../../domain/types';

export interface MemoryStore {
  readonly apps: AppRepository;
  readonly deployments: DeploymentRepository;
  readonly grants: GrantRepository;
  readonly groups: GroupRepository;
  readonly audit: AuditRepository;
  readonly agents: AgentIdentityRepository;
  /** Direkter Blick in das Audit-Log, fuer Tests. */
  readonly auditEntries: readonly AuditEntry[];
}

export function createMemoryStore(options?: { now?: () => Date }): MemoryStore {
  const now = options?.now ?? ((): Date => new Date());
  let counter = 0;
  const nextId = (prefix: string): string => `${prefix}-${++counter}`;

  const apps = new Map<string, App>();
  const deployments = new Map<string, Deployment>();
  const grants = new Map<string, Grant>();
  const auditEntries: AuditEntry[] = [];
  const agents = new Map<string, AgentIdentity>();
  const groups = new Map<string, Group>();
  // Gruppe -> E-Mail -> Mitgliedschaft. Die aeussere Map traegt denselben
  // Schluessel wie `groups`, die innere ist nach E-Mail eindeutig — genau der
  // Primaerschluessel aus Migration 0009.
  const members = new Map<string, Map<string, GroupMember>>();
  const agentSecrets = new Map<string, string>();

  const appRepo: AppRepository = {
    async create(input: NewApp): Promise<App> {
      if ([...apps.values()].some((a) => a.name === input.name)) {
        throw new ConflictError(`App "${input.name}" gibt es schon`);
      }
      const app: App = {
        id: nextId('app'),
        name: input.name,
        displayName: input.displayName,
        category: input.category,
        manifest: input.manifest,
        source: input.source,
        schemaName: input.schemaName,
        dbRole: input.dbRole,
        primaryDomain: null,
        authSecretGeneration: 1,
        currentDeploymentId: null,
        previousDeploymentId: null,
        archivedAt: null,
        createdBy: input.createdBy,
        createdAt: now(),
      };
      apps.set(app.id, app);
      return app;
    },
    async findById(id) {
      return apps.get(id) ?? null;
    },
    async findByName(name) {
      return [...apps.values()].find((a) => a.name === name) ?? null;
    },
    async listAll() {
      return [...apps.values()].filter((a) => a.archivedAt === null);
    },
    async setDeploymentPointers(appId, currentId, previousId) {
      apps.set(appId, {
        ...mustApp(apps, appId),
        currentDeploymentId: currentId,
        previousDeploymentId: previousId,
      });
    },
    async setPrimaryDomain(appId, domain) {
      apps.set(appId, { ...mustApp(apps, appId), primaryDomain: domain });
    },
    async setManifest(appId, manifest) {
      apps.set(appId, { ...mustApp(apps, appId), manifest });
    },
  };

  const deploymentRepo: DeploymentRepository = {
    async create(input: NewDeployment): Promise<Deployment> {
      const deployment: Deployment = {
        id: nextId('dep'),
        appId: input.appId,
        version: input.version,
        gitSha: input.gitSha,
        status: 'pending',
        reviewDecision: null,
        reviewResult: null,
        backendRef: null,
        requestedBy: input.requestedBy,
        requestedAt: now(),
        reviewedAt: null,
        deployedAt: null,
      };
      deployments.set(deployment.id, deployment);
      return deployment;
    },
    async findById(id) {
      return deployments.get(id) ?? null;
    },
    async listByApp(appId) {
      return [...deployments.values()]
        .filter((d) => d.appId === appId)
        .sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime());
    },
    async patch(id, patch: DeploymentPatch) {
      const current = deployments.get(id);
      if (current === undefined) throw new NotFoundError(`Deployment "${id}" gibt es nicht`);
      const updated: Deployment = {
        ...current,
        ...(patch.status === undefined ? {} : { status: patch.status }),
        ...(patch.reviewDecision === undefined ? {} : { reviewDecision: patch.reviewDecision }),
        ...(patch.reviewResult === undefined ? {} : { reviewResult: patch.reviewResult }),
        ...(patch.backendRef === undefined ? {} : { backendRef: patch.backendRef }),
        ...(patch.reviewedAt === undefined ? {} : { reviewedAt: patch.reviewedAt }),
        ...(patch.deployedAt === undefined ? {} : { deployedAt: patch.deployedAt }),
      };
      deployments.set(id, updated);
      return updated;
    },
  };

  const grantRepo: GrantRepository = {
    async insert(input: NewGrant): Promise<Grant> {
      const entry: Grant = {
        id: nextId('grant'),
        subject: input.subject,
        verb: input.verb,
        resource: input.resource,
        grantedBy: input.grantedBy,
        grantedAt: now(),
        revokedAt: null,
        revokedBy: null,
      };
      grants.set(entry.id, entry);
      return entry;
    },
    async findActive(lookup: GrantLookup) {
      return [...grants.values()].filter((g) => grantMatches(g, lookup));
    },
    async findActiveById(id) {
      const entry = grants.get(id);
      if (entry === undefined || entry.revokedAt !== null) return null;
      return entry;
    },
    async findActiveMatching(match) {
      return (
        [...grants.values()].find(
          (g) =>
            g.revokedAt === null &&
            g.verb === match.verb &&
            g.subject.kind === match.subject.kind &&
            g.subject.id === match.subject.id &&
            g.resource.kind === match.resource.kind &&
            g.resource.id === match.resource.id,
        ) ?? null
      );
    },
    async revoke(id, revokedBy, revokedAt) {
      const entry = grants.get(id);
      if (entry === undefined) throw new NotFoundError(`Freigabe "${id}" gibt es nicht`);
      const updated: Grant = { ...entry, revokedAt, revokedBy };
      grants.set(id, updated);
      return updated;
    },
    async listForSubjects(subjects: readonly SubjectRef[]) {
      return [...grants.values()].filter((g) =>
        subjects.some((s) => s.kind === g.subject.kind && s.id === g.subject.id),
      );
    },
    async listForResource(resource: ResourceRef) {
      return [...grants.values()].filter(
        (g) => g.resource.kind === resource.kind && g.resource.id === resource.id,
      );
    },
    async listAll(limit) {
      return [...grants.values()]
        .sort((a, b) => b.grantedAt.getTime() - a.grantedAt.getTime())
        .slice(0, limit);
    },
  };

  const auditRepo: AuditRepository = {
    async append(entry) {
      auditEntries.push(entry);
    },
    async list(limit) {
      return auditEntries.slice(-limit).reverse();
    },
  };

  const agentRepo: AgentIdentityRepository = {
    async create(input: NewAgentIdentity): Promise<AgentIdentity> {
      const identity: AgentIdentity = {
        id: nextId('agent'),
        name: input.name,
        displayName: input.displayName,
        oauthClientId: input.oauthClientId,
        ownerUserId: input.ownerUserId,
        createdAt: now(),
        lastSeenAt: null,
        disabledAt: null,
      };
      agents.set(identity.id, identity);
      agentSecrets.set(input.oauthClientId, input.oauthClientSecretHash);
      return identity;
    },
    async findByName(name) {
      return [...agents.values()].find((a) => a.name === name) ?? null;
    },
    async findByClientId(clientId) {
      return [...agents.values()].find((a) => a.oauthClientId === clientId) ?? null;
    },
    async secretHashOf(clientId) {
      return agentSecrets.get(clientId) ?? null;
    },
    async touch(clientId, at) {
      const identity = [...agents.values()].find((a) => a.oauthClientId === clientId);
      if (identity === undefined) return;
      agents.set(identity.id, { ...identity, lastSeenAt: at });
    },
    async list() {
      return [...agents.values()];
    },
  };

  /**
   * Dieselbe Semantik wie in SQL, an den Stellen, die zaehlen: E-Mails
   * kleingeschrieben (Migration 0009 erzwingt das per CHECK), Mitgliedschaft
   * idempotent, Listen sortiert. Lief das hier anders, wuerden die Tests der
   * Domaene etwas anderes pruefen als den Betrieb.
   */
  const groupRepo: GroupRepository = {
    async create(input: { name: string; description: string }): Promise<Group> {
      if (groups.has(input.name)) throw new ConflictError(`Gruppe "${input.name}" gibt es schon`);
      const group: Group = {
        name: input.name,
        description: input.description,
        createdAt: now(),
      };
      groups.set(group.name, group);
      members.set(group.name, new Map());
      return group;
    },
    async findByName(name) {
      return groups.get(name) ?? null;
    },
    async listAll() {
      return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
    },
    async listMembers(group) {
      return [...(members.get(group)?.values() ?? [])].sort((a, b) =>
        a.email.localeCompare(b.email),
      );
    },
    async groupsFor(email) {
      const normalized = email.trim().toLowerCase();
      if (normalized === '') return [];
      return [...members.entries()]
        .filter(([, byEmail]) => byEmail.has(normalized))
        .map(([group]) => group)
        .sort((a, b) => a.localeCompare(b));
    },
    async ensureMembership(group, email, addedBy) {
      // Fremdschluessel wie in SQL: eine Mitgliedschaft in einer Gruppe, die
      // es nicht gibt, ist ein Fehler und kein stilles Anlegen.
      if (!groups.has(group)) throw new NotFoundError(`Gruppe "${group}" gibt es nicht`);
      const byEmail = members.get(group) ?? new Map<string, GroupMember>();
      const normalized = email.trim().toLowerCase();
      if (!byEmail.has(normalized)) {
        byEmail.set(normalized, { email: normalized, addedBy, addedAt: now() });
      }
      members.set(group, byEmail);
    },
    async removeMembership(group, email) {
      members.get(group)?.delete(email.trim().toLowerCase());
    },
  };

  return {
    apps: appRepo,
    deployments: deploymentRepo,
    grants: grantRepo,
    groups: groupRepo,
    audit: auditRepo,
    agents: agentRepo,
    auditEntries,
  };
}

function mustApp(apps: Map<string, App>, id: string): App {
  const app = apps.get(id);
  if (app === undefined) throw new NotFoundError(`App "${id}" gibt es nicht`);
  return app;
}
