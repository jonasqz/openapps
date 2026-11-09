/**
 * Die Repositories gegen Postgres. Reines SQL, kein ORM — die Migrationen
 * sind die Quelle der Wahrheit, nicht ein Modell im Code.
 *
 * Die Freigabe-Abfrage (`findActive`) ist die wichtigste Zeile der Datei: sie
 * fragt bei **jedem** Aufruf, filtert auf `revoked_at IS NULL` und kennt die
 * Wildcard '*'. Kein Cache, nirgends (DoD 3).
 */

import { NotFoundError } from '../../domain/errors';
import type {
  AgentIdentityRepository,
  AppRepository,
  AuditRepository,
  DeploymentPatch,
  DeploymentRepository,
  GrantLookup,
  GrantRepository,
  NewAgentIdentity,
  NewApp,
  NewDeployment,
  NewGrant,
} from '../../domain/ports';
import type {
  AgentIdentity,
  App,
  AppManifest,
  AuditEntry,
  CatalogSource,
  Deployment,
  DeploymentStatus,
  Grant,
  ResourceKind,
  ResourceRef,
  ReviewDecision,
  SubjectKind,
  SubjectRef,
  Verb,
} from '../../domain/types';
import type { Queryable } from './pool';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ------------------------------- apps ------------------------------------ */

const APP_COLUMNS = `
  id, name, display_name, category, manifest, source, schema_name, db_role,
  primary_domain, current_deployment_id, previous_deployment_id, archived_at,
  created_by, created_at`;

interface AppRow extends Record<string, unknown> {
  id: string;
  name: string;
  display_name: string;
  category: string | null;
  manifest: AppManifest;
  source: CatalogSource;
  schema_name: string;
  db_role: string;
  primary_domain: string | null;
  current_deployment_id: string | null;
  previous_deployment_id: string | null;
  archived_at: Date | null;
  created_by: string;
  created_at: Date;
}

function toApp(row: AppRow): App {
  return {
    id: row.id,
    name: row.name,
    displayName: row.display_name,
    category: row.category,
    manifest: row.manifest,
    source: row.source,
    schemaName: row.schema_name,
    dbRole: row.db_role,
    primaryDomain: row.primary_domain,
    currentDeploymentId: row.current_deployment_id,
    previousDeploymentId: row.previous_deployment_id,
    archivedAt: row.archived_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export function createAppRepository(db: Queryable): AppRepository {
  return {
    async create(input: NewApp): Promise<App> {
      const { rows } = await db.query<AppRow>(
        `INSERT INTO apps (name, display_name, category, manifest, source, schema_name, db_role, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING ${APP_COLUMNS}`,
        [
          input.name,
          input.displayName,
          input.category,
          JSON.stringify(input.manifest),
          JSON.stringify(input.source),
          input.schemaName,
          input.dbRole,
          input.createdBy,
        ],
      );
      return toApp(must(rows, 'App konnte nicht angelegt werden'));
    },
    async findById(id) {
      // Eine Nicht-UUID ist kein Fehler, sondern ein Name — und wird hier
      // nicht zur Datenbank geschickt, damit Postgres nicht auf dem Cast
      // abbricht.
      if (!UUID.test(id)) return null;
      const { rows } = await db.query<AppRow>(
        `SELECT ${APP_COLUMNS} FROM apps WHERE id = $1`,
        [id],
      );
      return rows[0] === undefined ? null : toApp(rows[0]);
    },
    async findByName(name) {
      const { rows } = await db.query<AppRow>(
        `SELECT ${APP_COLUMNS} FROM apps WHERE name = $1`,
        [name],
      );
      return rows[0] === undefined ? null : toApp(rows[0]);
    },
    async findByDomain(domain) {
      const { rows } = await db.query<AppRow>(
        `SELECT ${APP_COLUMNS} FROM apps WHERE primary_domain = $1 AND archived_at IS NULL`,
        [domain],
      );
      return rows[0] === undefined ? null : toApp(rows[0]);
    },
    async listAll() {
      const { rows } = await db.query<AppRow>(
        `SELECT ${APP_COLUMNS} FROM apps WHERE archived_at IS NULL ORDER BY name`,
      );
      return rows.map(toApp);
    },
    async setDeploymentPointers(appId, currentId, previousId) {
      await db.query(
        `UPDATE apps
            SET current_deployment_id = $2, previous_deployment_id = $3, updated_at = now()
          WHERE id = $1`,
        [appId, currentId, previousId],
      );
    },
    async setPrimaryDomain(appId, domain) {
      await db.query(`UPDATE apps SET primary_domain = $2, updated_at = now() WHERE id = $1`, [
        appId,
        domain,
      ]);
    },
    async setManifest(appId, manifest) {
      await db.query(`UPDATE apps SET manifest = $2, updated_at = now() WHERE id = $1`, [
        appId,
        JSON.stringify(manifest),
      ]);
    },
  };
}

/* --------------------------- deployments --------------------------------- */

const DEPLOYMENT_COLUMNS = `
  id, app_id, version, git_sha, status, review_decision, review_result,
  backend_ref, requested_by, requested_at, reviewed_at, deployed_at`;

interface DeploymentRow extends Record<string, unknown> {
  id: string;
  app_id: string;
  version: string;
  git_sha: string;
  status: DeploymentStatus;
  review_decision: ReviewDecision | null;
  review_result: unknown;
  backend_ref: string | null;
  requested_by: string;
  requested_at: Date;
  reviewed_at: Date | null;
  deployed_at: Date | null;
}

function toDeployment(row: DeploymentRow): Deployment {
  return {
    id: row.id,
    appId: row.app_id,
    version: row.version,
    gitSha: row.git_sha,
    status: row.status,
    reviewDecision: row.review_decision,
    reviewResult: row.review_result,
    backendRef: row.backend_ref,
    requestedBy: row.requested_by,
    requestedAt: row.requested_at,
    reviewedAt: row.reviewed_at,
    deployedAt: row.deployed_at,
  };
}

export function createDeploymentRepository(db: Queryable): DeploymentRepository {
  return {
    async create(input: NewDeployment): Promise<Deployment> {
      const { rows } = await db.query<DeploymentRow>(
        `INSERT INTO deployments (app_id, version, git_sha, requested_by)
         VALUES ($1, $2, $3, $4)
         RETURNING ${DEPLOYMENT_COLUMNS}`,
        [input.appId, input.version, input.gitSha, input.requestedBy],
      );
      return toDeployment(must(rows, 'Deployment konnte nicht angelegt werden'));
    },
    async findById(id) {
      if (!UUID.test(id)) return null;
      const { rows } = await db.query<DeploymentRow>(
        `SELECT ${DEPLOYMENT_COLUMNS} FROM deployments WHERE id = $1`,
        [id],
      );
      return rows[0] === undefined ? null : toDeployment(rows[0]);
    },
    async listByApp(appId) {
      const { rows } = await db.query<DeploymentRow>(
        `SELECT ${DEPLOYMENT_COLUMNS} FROM deployments WHERE app_id = $1
         ORDER BY requested_at DESC`,
        [appId],
      );
      return rows.map(toDeployment);
    },
    async patch(id, patch: DeploymentPatch) {
      const { rows } = await db.query<DeploymentRow>(
        `UPDATE deployments SET
           status          = COALESCE($2, status),
           review_decision = COALESCE($3, review_decision),
           review_result   = COALESCE($4::jsonb, review_result),
           backend_ref     = COALESCE($5, backend_ref),
           reviewed_at     = COALESCE($6, reviewed_at),
           deployed_at     = COALESCE($7, deployed_at)
         WHERE id = $1
         RETURNING ${DEPLOYMENT_COLUMNS}`,
        [
          id,
          patch.status ?? null,
          patch.reviewDecision ?? null,
          patch.reviewResult === undefined ? null : JSON.stringify(patch.reviewResult),
          patch.backendRef ?? null,
          patch.reviewedAt ?? null,
          patch.deployedAt ?? null,
        ],
      );
      const row = rows[0];
      if (row === undefined) throw new NotFoundError(`Deployment "${id}" gibt es nicht`);
      return toDeployment(row);
    },
  };
}

/* ------------------------------- grants ---------------------------------- */

const GRANT_COLUMNS = `
  id, subject_kind, subject_id, verb, resource_kind, resource_id,
  granted_by, granted_at, revoked_at, revoked_by`;

interface GrantRow extends Record<string, unknown> {
  id: string;
  subject_kind: SubjectKind;
  subject_id: string;
  verb: Verb;
  resource_kind: ResourceKind;
  resource_id: string;
  granted_by: string;
  granted_at: Date;
  revoked_at: Date | null;
  revoked_by: string | null;
}

function toGrant(row: GrantRow): Grant {
  return {
    id: row.id,
    subject: { kind: row.subject_kind, id: row.subject_id },
    verb: row.verb,
    resource: { kind: row.resource_kind, id: row.resource_id },
    grantedBy: row.granted_by,
    grantedAt: row.granted_at,
    revokedAt: row.revoked_at,
    revokedBy: row.revoked_by,
  };
}

export function createGrantRepository(db: Queryable): GrantRepository {
  return {
    async insert(input: NewGrant): Promise<Grant> {
      const { rows } = await db.query<GrantRow>(
        `INSERT INTO grants (subject_kind, subject_id, verb, resource_kind, resource_id, granted_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${GRANT_COLUMNS}`,
        [
          input.subject.kind,
          input.subject.id,
          input.verb,
          input.resource.kind,
          input.resource.id,
          input.grantedBy,
        ],
      );
      return toGrant(must(rows, 'Freigabe konnte nicht angelegt werden'));
    },

    /**
     * Die Pruefabfrage. `revoked_at IS NULL` und die Wildcard stehen im SQL,
     * damit kein Aufrufer sie vergessen kann.
     */
    async findActive(lookup: GrantLookup) {
      if (lookup.subjects.length === 0) return [];
      const kinds = lookup.subjects.map((s) => s.kind);
      const ids = lookup.subjects.map((s) => s.id);
      const { rows } = await db.query<GrantRow>(
        `SELECT ${GRANT_COLUMNS} FROM grants
          WHERE revoked_at IS NULL
            AND verb = $1
            AND resource_kind = $2
            AND resource_id IN ($3, '*')
            AND (subject_kind, subject_id) IN (
                  SELECT * FROM unnest($4::grant_subject_kind[], $5::text[])
                )`,
        [lookup.verb, lookup.resource.kind, lookup.resource.id, kinds, ids],
      );
      return rows.map(toGrant);
    },

    async findActiveById(id) {
      if (!UUID.test(id)) return null;
      const { rows } = await db.query<GrantRow>(
        `SELECT ${GRANT_COLUMNS} FROM grants WHERE id = $1 AND revoked_at IS NULL`,
        [id],
      );
      return rows[0] === undefined ? null : toGrant(rows[0]);
    },

    async findActiveMatching(match) {
      const { rows } = await db.query<GrantRow>(
        `SELECT ${GRANT_COLUMNS} FROM grants
          WHERE revoked_at IS NULL
            AND subject_kind = $1 AND subject_id = $2
            AND verb = $3
            AND resource_kind = $4 AND resource_id = $5`,
        [
          match.subject.kind,
          match.subject.id,
          match.verb,
          match.resource.kind,
          match.resource.id,
        ],
      );
      return rows[0] === undefined ? null : toGrant(rows[0]);
    },

    async revoke(id, revokedBy, revokedAt) {
      const { rows } = await db.query<GrantRow>(
        `UPDATE grants SET revoked_at = $2, revoked_by = $3
          WHERE id = $1 AND revoked_at IS NULL
         RETURNING ${GRANT_COLUMNS}`,
        [id, revokedAt, revokedBy],
      );
      const row = rows[0];
      if (row === undefined) throw new NotFoundError(`offene Freigabe "${id}" gibt es nicht`);
      return toGrant(row);
    },

    async listForSubjects(subjects: readonly SubjectRef[]) {
      if (subjects.length === 0) return [];
      const { rows } = await db.query<GrantRow>(
        `SELECT ${GRANT_COLUMNS} FROM grants
          WHERE (subject_kind, subject_id) IN (
                  SELECT * FROM unnest($1::grant_subject_kind[], $2::text[])
                )
          ORDER BY granted_at DESC`,
        [subjects.map((s) => s.kind), subjects.map((s) => s.id)],
      );
      return rows.map(toGrant);
    },

    async listForResource(resource: ResourceRef) {
      const { rows } = await db.query<GrantRow>(
        `SELECT ${GRANT_COLUMNS} FROM grants
          WHERE resource_kind = $1 AND resource_id = $2
          ORDER BY granted_at DESC`,
        [resource.kind, resource.id],
      );
      return rows.map(toGrant);
    },

    async listAll(limit) {
      const { rows } = await db.query<GrantRow>(
        `SELECT ${GRANT_COLUMNS} FROM grants ORDER BY granted_at DESC LIMIT $1`,
        [limit],
      );
      return rows.map(toGrant);
    },
  };
}

/* ------------------------------ audit log -------------------------------- */

interface AuditRow extends Record<string, unknown> {
  occurred_at: Date;
  actor_kind: SubjectKind;
  actor_id: string;
  action: string;
  resource_kind: ResourceKind | null;
  resource_id: string | null;
  outcome: 'allowed' | 'denied' | 'error';
  reason: string | null;
  detail: Record<string, unknown>;
  correlation_id: string | null;
}

export function createAuditRepository(db: Queryable): AuditRepository {
  return {
    async append(entry: AuditEntry) {
      await db.query(
        `INSERT INTO audit_log
           (occurred_at, actor_kind, actor_id, action, resource_kind, resource_id,
            outcome, reason, detail, correlation_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
        [
          entry.occurredAt,
          entry.actor.kind,
          entry.actor.id,
          entry.action,
          entry.resource?.kind ?? null,
          entry.resource?.id ?? null,
          entry.outcome,
          entry.reason,
          JSON.stringify(entry.detail),
          entry.correlationId,
        ],
      );
    },
    async list(limit) {
      const { rows } = await db.query<AuditRow>(
        `SELECT occurred_at, actor_kind, actor_id, action, resource_kind, resource_id,
                outcome, reason, detail, correlation_id
           FROM audit_log ORDER BY occurred_at DESC, id DESC LIMIT $1`,
        [limit],
      );
      return rows.map(
        (row): AuditEntry => ({
          occurredAt: row.occurred_at,
          actor: { kind: row.actor_kind, id: row.actor_id },
          action: row.action,
          resource:
            row.resource_kind === null || row.resource_id === null
              ? null
              : { kind: row.resource_kind, id: row.resource_id },
          outcome: row.outcome,
          reason: row.reason,
          detail: row.detail,
          correlationId: row.correlation_id,
        }),
      );
    },
  };
}

/* -------------------------- agent identities ----------------------------- */

interface AgentRow extends Record<string, unknown> {
  id: string;
  name: string;
  display_name: string;
  oauth_client_id: string;
  owner_user_id: string;
  created_at: Date;
  last_seen_at: Date | null;
  disabled_at: Date | null;
}

function toAgent(row: AgentRow): AgentIdentity {
  return {
    id: row.id,
    name: row.name,
    displayName: row.display_name,
    oauthClientId: row.oauth_client_id,
    ownerUserId: row.owner_user_id,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    disabledAt: row.disabled_at,
  };
}

const AGENT_COLUMNS = `
  id, name, display_name, oauth_client_id, owner_user_id, created_at,
  last_seen_at, disabled_at`;

export function createAgentIdentityRepository(db: Queryable): AgentIdentityRepository {
  return {
    async create(input: NewAgentIdentity): Promise<AgentIdentity> {
      const { rows } = await db.query<AgentRow>(
        `INSERT INTO agent_identities
           (name, display_name, oauth_client_id, oauth_client_secret_hash, owner_user_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${AGENT_COLUMNS}`,
        [
          input.name,
          input.displayName,
          input.oauthClientId,
          input.oauthClientSecretHash,
          input.ownerUserId,
        ],
      );
      return toAgent(must(rows, 'Agent-Identitaet konnte nicht angelegt werden'));
    },
    async findByName(name) {
      const { rows } = await db.query<AgentRow>(
        `SELECT ${AGENT_COLUMNS} FROM agent_identities WHERE name = $1`,
        [name],
      );
      return rows[0] === undefined ? null : toAgent(rows[0]);
    },
    async findByClientId(clientId) {
      const { rows } = await db.query<AgentRow>(
        `SELECT ${AGENT_COLUMNS} FROM agent_identities
          WHERE oauth_client_id = $1 AND disabled_at IS NULL`,
        [clientId],
      );
      return rows[0] === undefined ? null : toAgent(rows[0]);
    },
    async secretHashOf(clientId) {
      const { rows } = await db.query<{ oauth_client_secret_hash: string }>(
        `SELECT oauth_client_secret_hash FROM agent_identities
          WHERE oauth_client_id = $1 AND disabled_at IS NULL`,
        [clientId],
      );
      return rows[0]?.oauth_client_secret_hash ?? null;
    },
    async touch(clientId, at) {
      await db.query(`UPDATE agent_identities SET last_seen_at = $2 WHERE oauth_client_id = $1`, [
        clientId,
        at,
      ]);
    },
    async list() {
      const { rows } = await db.query<AgentRow>(
        `SELECT ${AGENT_COLUMNS} FROM agent_identities ORDER BY name`,
      );
      return rows.map(toAgent);
    },
  };
}

function must<T>(rows: readonly T[], message: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(message);
  return row;
}
