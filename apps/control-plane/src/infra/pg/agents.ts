/**
 * Modell-Nutzung, Agent-Profile, Laeufe und Team-Gedaechtnis in Postgres
 * (Migrationen 0021 bis 0024, ADR 0024). Reines SQL wie `repositories.ts`.
 * Keine Rechte hier: Wer was sehen darf, entscheidet die Domaene; diese
 * Datei filtert nur nach dem, was sie bekommt.
 */

import type pg from 'pg';
import { NotFoundError } from '../../domain/errors';
import type {
  AgentProfile,
  AgentProfileRepository,
  AgentRun,
  AgentRunRepository,
  AgentRunToolCall,
  MemoryEntry,
  ModelUsageRepository,
  TeamMemoryStore,
} from '../../domain/ports';
import type { Queryable } from './pool';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createModelUsageRepository(db: Queryable): ModelUsageRepository {
  return {
    async append(row) {
      await db.query(
        `INSERT INTO model_usage (occurred_at, subject_kind, subject_id, purpose, kind, provider,
                                  model, input_tokens, output_tokens, duration_ms, outcome, run_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          row.occurredAt,
          row.subject.kind,
          row.subject.id,
          row.purpose,
          row.kind,
          row.provider,
          row.model,
          row.inputTokens,
          row.outputTokens,
          row.durationMs,
          row.outcome,
          row.runId !== null && UUID.test(row.runId) ? row.runId : null,
        ],
      );
    },
    async tokensSince(since, subject) {
      const { rows } = await db.query<{ total: string | null }>(
        subject === undefined
          ? `SELECT COALESCE(SUM(input_tokens + output_tokens), 0)::text AS total
               FROM model_usage WHERE occurred_at >= $1`
          : `SELECT COALESCE(SUM(input_tokens + output_tokens), 0)::text AS total
               FROM model_usage
              WHERE occurred_at >= $1 AND subject_kind = $2 AND subject_id = $3`,
        subject === undefined ? [since] : [since, subject.kind, subject.id],
      );
      return Number(rows[0]?.total ?? '0');
    },
  };
}

interface ProfileRow extends Record<string, unknown> {
  agent_name: string;
  instructions: string;
  model: string | null;
  max_steps: number;
  token_budget: number;
  updated_by: string;
  updated_at: Date;
}

function toProfile(row: ProfileRow): AgentProfile {
  return {
    agentName: row.agent_name,
    instructions: row.instructions,
    model: row.model,
    maxSteps: row.max_steps,
    tokenBudget: row.token_budget,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

const PROFILE_COLUMNS =
  'agent_name, instructions, model, max_steps, token_budget, updated_by, updated_at';

export function createAgentProfileRepository(db: Queryable): AgentProfileRepository {
  return {
    async upsert(profile) {
      const { rows } = await db.query<ProfileRow>(
        `INSERT INTO agent_profiles (agent_name, instructions, model, max_steps, token_budget, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (agent_name) DO UPDATE
           SET instructions = EXCLUDED.instructions, model = EXCLUDED.model,
               max_steps = EXCLUDED.max_steps, token_budget = EXCLUDED.token_budget,
               updated_by = EXCLUDED.updated_by, updated_at = now()
         RETURNING ${PROFILE_COLUMNS}`,
        [
          profile.agentName,
          profile.instructions,
          profile.model,
          profile.maxSteps,
          profile.tokenBudget,
          profile.updatedBy,
        ],
      );
      return toProfile(rows[0] as ProfileRow);
    },
    async find(name) {
      const { rows } = await db.query<ProfileRow>(
        `SELECT ${PROFILE_COLUMNS} FROM agent_profiles WHERE agent_name = $1`,
        [name],
      );
      return rows[0] === undefined ? null : toProfile(rows[0]);
    },
    async list() {
      const { rows } = await db.query<ProfileRow>(
        `SELECT ${PROFILE_COLUMNS} FROM agent_profiles ORDER BY agent_name`,
      );
      return rows.map(toProfile);
    },
  };
}

interface RunRow extends Record<string, unknown> {
  id: string;
  agent_name: string;
  status: AgentRun['status'];
  trigger_kind: AgentRun['triggerKind'];
  trigger_subject_kind: 'user' | 'agent';
  trigger_subject_id: string;
  trigger_email: string | null;
  source: string | null;
  source_app: string | null;
  source_path: string | null;
  prompt: string;
  result: string | null;
  error_code: string | null;
  error_message: string | null;
  steps: number;
  input_tokens: number;
  output_tokens: number;
  used_apps: string[];
  tool_calls: unknown;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  lease_until: Date | null;
}

const RUN_COLUMNS = `id, agent_name, status, trigger_kind, trigger_subject_kind, trigger_subject_id,
  trigger_email, source, source_app, source_path, prompt, result, error_code, error_message,
  steps, input_tokens, output_tokens, used_apps, tool_calls, created_at, started_at,
  finished_at, lease_until`;

function toolCallsOf(value: unknown): AgentRunToolCall[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is AgentRunToolCall =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as { tool?: unknown }).tool === 'string' &&
      typeof (entry as { ok?: unknown }).ok === 'boolean' &&
      typeof (entry as { at?: unknown }).at === 'string',
  );
}

function toRun(row: RunRow): AgentRun {
  return {
    id: row.id,
    agentName: row.agent_name,
    status: row.status,
    triggerKind: row.trigger_kind,
    trigger: {
      kind: row.trigger_subject_kind,
      id: row.trigger_subject_id,
      email: row.trigger_email,
    },
    source: row.source,
    sourceApp: row.source_app,
    sourcePath: row.source_path,
    prompt: row.prompt,
    result: row.result,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    steps: row.steps,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    usedApps: row.used_apps,
    toolCalls: toolCallsOf(row.tool_calls),
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    leaseUntil: row.lease_until,
  };
}

/** Braucht eine Verbindung mit Transaktionen (`pg.Pool`) fuer `claimNext`. */
export function createAgentRunRepository(pool: pg.Pool): AgentRunRepository {
  return {
    async create(run) {
      const { rows } = await pool.query<RunRow>(
        `INSERT INTO agent_runs (agent_name, trigger_kind, trigger_subject_kind, trigger_subject_id,
                                 trigger_email, source, source_app, source_path, prompt, used_apps,
                                 dedupe_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (dedupe_key) DO NOTHING
         RETURNING ${RUN_COLUMNS}`,
        [
          run.agentName,
          run.triggerKind,
          run.trigger.kind,
          run.trigger.id,
          run.trigger.email,
          run.source,
          run.sourceApp,
          run.sourcePath,
          run.prompt,
          [...run.usedApps].sort(),
          run.dedupeKey,
        ],
      );
      return rows[0] === undefined ? null : toRun(rows[0]);
    },

    async findById(id) {
      if (!UUID.test(id)) return null;
      const { rows } = await pool.query<RunRow>(
        `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = $1`,
        [id],
      );
      return rows[0] === undefined ? null : toRun(rows[0]);
    },

    async list(filter) {
      const { rows } = await pool.query<RunRow>(
        `SELECT ${RUN_COLUMNS} FROM agent_runs
          WHERE agent_name = ANY($1::text[])
             OR (trigger_subject_kind = $2 AND trigger_subject_id = $3)
          ORDER BY created_at DESC, id DESC
          LIMIT $4`,
        [
          [...(filter.agentNames ?? [])],
          filter.triggeredBy?.kind ?? null,
          filter.triggeredBy?.id ?? null,
          filter.limit,
        ],
      );
      return rows.map(toRun);
    },

    async claimNext({ now, leaseUntil }) {
      const { rows } = await pool.query<RunRow>(
        `UPDATE agent_runs SET status = 'running', started_at = $1, lease_until = $2
          WHERE id = (SELECT id FROM agent_runs WHERE status = 'queued'
                       ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED)
          RETURNING ${RUN_COLUMNS}`,
        [now, leaseUntil],
      );
      return rows[0] === undefined ? null : toRun(rows[0]);
    },

    async update(id, patch) {
      const sets: string[] = [];
      const params: unknown[] = [];
      const set = (column: string, value: unknown): void => {
        params.push(value);
        sets.push(`${column} = $${String(params.length)}`);
      };
      if (patch.status !== undefined) set('status', patch.status);
      if (patch.result !== undefined) set('result', patch.result);
      if (patch.errorCode !== undefined) set('error_code', patch.errorCode);
      if (patch.errorMessage !== undefined) set('error_message', patch.errorMessage);
      if (patch.steps !== undefined) set('steps', patch.steps);
      if (patch.inputTokens !== undefined) set('input_tokens', patch.inputTokens);
      if (patch.outputTokens !== undefined) set('output_tokens', patch.outputTokens);
      if (patch.usedApps !== undefined) set('used_apps', [...patch.usedApps].sort());
      if (patch.toolCalls !== undefined) set('tool_calls', JSON.stringify(patch.toolCalls));
      if (patch.startedAt !== undefined) set('started_at', patch.startedAt);
      if (patch.finishedAt !== undefined) set('finished_at', patch.finishedAt);
      if (patch.leaseUntil !== undefined) set('lease_until', patch.leaseUntil);
      params.push(id);
      const { rows } = await pool.query<RunRow>(
        sets.length === 0
          ? `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = $1`
          : `UPDATE agent_runs SET ${sets.join(', ')} WHERE id = $${String(params.length)}
             RETURNING ${RUN_COLUMNS}`,
        sets.length === 0 ? [id] : params,
      );
      if (rows[0] === undefined) throw new NotFoundError(`agent run "${id}" does not exist`);
      return toRun(rows[0]);
    },

    async failExpired(now, errorCode, errorMessage) {
      const { rowCount } = await pool.query(
        `UPDATE agent_runs
            SET status = 'failed', error_code = $2, error_message = $3, finished_at = $1,
                lease_until = NULL
          WHERE status = 'running' AND lease_until < $1`,
        [now, errorCode, errorMessage],
      );
      return rowCount ?? 0;
    },
  };
}

interface MemoryRow extends Record<string, unknown> {
  id: string;
  author: string;
  text: string;
  apps: string[];
  run_id: string | null;
  created_at: Date;
}

const MEMORY_COLUMNS = 'id, author, text, apps, run_id, created_at';

function toMemory(row: MemoryRow): MemoryEntry {
  return {
    id: row.id,
    author: row.author,
    text: row.text,
    apps: row.apps,
    runId: row.run_id,
    createdAt: row.created_at,
  };
}

/** Das Postgres-Gedaechtnis: Volltext (`simple`), Herkunft als Teilmenge der lesbaren Apps. */
export function createTeamMemoryStore(db: Queryable): TeamMemoryStore {
  return {
    async remember(entry) {
      const { rows } = await db.query<MemoryRow>(
        `INSERT INTO memories (author, text, apps, run_id) VALUES ($1, $2, $3, $4)
         RETURNING ${MEMORY_COLUMNS}`,
        [
          entry.author,
          entry.text,
          [...new Set(entry.apps)].sort(),
          entry.runId !== null && UUID.test(entry.runId) ? entry.runId : null,
        ],
      );
      return toMemory(rows[0] as MemoryRow);
    },
    async recall({ query, readableApps, limit }) {
      const { rows } = await db.query<MemoryRow>(
        `SELECT ${MEMORY_COLUMNS} FROM memories
          WHERE apps <@ $1::text[]
            AND (search @@ websearch_to_tsquery('simple', $2) OR text ILIKE '%' || $3 || '%')
          ORDER BY ts_rank(search, websearch_to_tsquery('simple', $2)) DESC, created_at DESC
          LIMIT $4`,
        [[...readableApps], query, query.replace(/[\\%_]/g, (c) => `\\${c}`), limit],
      );
      return rows.map(toMemory);
    },
    async list({ authors, readableApps, limit }) {
      const { rows } = await db.query<MemoryRow>(
        `SELECT ${MEMORY_COLUMNS} FROM memories
          WHERE apps <@ $1::text[] AND ($2::text[] IS NULL OR author = ANY($2::text[]))
          ORDER BY created_at DESC, id DESC
          LIMIT $3`,
        [[...readableApps], authors === undefined ? null : [...authors], limit],
      );
      return rows.map(toMemory);
    },
    async findById(id) {
      if (!UUID.test(id)) return null;
      const { rows } = await db.query<MemoryRow>(
        `SELECT ${MEMORY_COLUMNS} FROM memories WHERE id = $1`,
        [id],
      );
      return rows[0] === undefined ? null : toMemory(rows[0]);
    },
    async forget(id) {
      if (!UUID.test(id)) return false;
      const { rowCount } = await db.query('DELETE FROM memories WHERE id = $1', [id]);
      return (rowCount ?? 0) > 0;
    },
  };
}
