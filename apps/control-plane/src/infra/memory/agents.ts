/**
 * Modell-Nutzung, Agent-Profile, Laeufe und Team-Gedaechtnis im Prozess
 * (ADR 0024) — fuer die Tests der Domaene. Dieselbe Semantik wie die
 * Postgres-Fassungen in `src/infra/pg/agents.ts`.
 */

import { NotFoundError } from '../../domain/errors';
import type {
  AgentProfile,
  AgentProfileRepository,
  AgentRun,
  AgentRunRepository,
  MemoryEntry,
  ModelUsageRepository,
  ModelUsageRow,
  TeamMemoryStore,
} from '../../domain/ports';

export interface MemoryModelUsage extends ModelUsageRepository {
  readonly rows: readonly ModelUsageRow[];
}

export function createMemoryModelUsage(): MemoryModelUsage {
  const rows: ModelUsageRow[] = [];
  return {
    rows,
    async append(row) {
      rows.push(row);
    },
    async tokensSince(since, subject) {
      return rows
        .filter((row) => row.occurredAt.getTime() >= since.getTime())
        .filter(
          (row) =>
            subject === undefined ||
            (row.subject.kind === subject.kind && row.subject.id === subject.id),
        )
        .reduce((sum, row) => sum + row.inputTokens + row.outputTokens, 0);
    },
  };
}

export function createMemoryAgentProfiles(options?: { now?: () => Date }): AgentProfileRepository {
  const now = options?.now ?? ((): Date => new Date());
  const profiles = new Map<string, AgentProfile>();
  return {
    async upsert(profile) {
      const stored: AgentProfile = { ...profile, updatedAt: now() };
      profiles.set(profile.agentName, stored);
      return stored;
    },
    async find(name) {
      return profiles.get(name) ?? null;
    },
    async list() {
      return [...profiles.values()].sort((a, b) => a.agentName.localeCompare(b.agentName));
    },
  };
}

export interface MemoryAgentRuns extends AgentRunRepository {
  readonly all: () => readonly AgentRun[];
}

export function createMemoryAgentRuns(options?: { now?: () => Date }): MemoryAgentRuns {
  const now = options?.now ?? ((): Date => new Date());
  const runs = new Map<string, AgentRun>();
  const keys = new Set<string>();
  let counter = 0;
  const newest = (a: AgentRun, b: AgentRun): number =>
    b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id);
  return {
    all: () => [...runs.values()],
    async create(input) {
      if (input.dedupeKey !== null) {
        if (keys.has(input.dedupeKey)) return null;
        keys.add(input.dedupeKey);
      }
      counter += 1;
      const id = `00000000-0000-4000-8000-${counter.toString(16).padStart(12, '0')}`;
      const run: AgentRun = {
        id,
        agentName: input.agentName,
        status: 'queued',
        triggerKind: input.triggerKind,
        trigger: input.trigger,
        source: input.source,
        sourceApp: input.sourceApp,
        sourcePath: input.sourcePath,
        prompt: input.prompt,
        result: null,
        errorCode: null,
        errorMessage: null,
        steps: 0,
        inputTokens: 0,
        outputTokens: 0,
        usedApps: [...input.usedApps].sort(),
        toolCalls: [],
        createdAt: new Date(now().getTime() + counter),
        startedAt: null,
        finishedAt: null,
        leaseUntil: null,
      };
      runs.set(id, run);
      return run;
    },
    async findById(id) {
      return runs.get(id) ?? null;
    },
    async list(filter) {
      const agents = new Set(filter.agentNames ?? []);
      return [...runs.values()]
        .filter(
          (run) =>
            agents.has(run.agentName) ||
            (filter.triggeredBy !== undefined &&
              run.trigger.kind === filter.triggeredBy.kind &&
              run.trigger.id === filter.triggeredBy.id),
        )
        .sort(newest)
        .slice(0, filter.limit);
    },
    async claimNext({ now: at, leaseUntil }) {
      const next = [...runs.values()]
        .filter((run) => run.status === 'queued')
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
      if (next === undefined) return null;
      const claimed: AgentRun = { ...next, status: 'running', startedAt: at, leaseUntil };
      runs.set(next.id, claimed);
      return claimed;
    },
    async update(id, patch) {
      const run = runs.get(id);
      if (run === undefined) throw new NotFoundError(`agent run "${id}" does not exist`);
      const updated: AgentRun = {
        ...run,
        ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)),
      } as AgentRun;
      runs.set(id, updated);
      return updated;
    },
    async failExpired(at, errorCode, errorMessage) {
      let count = 0;
      for (const run of runs.values()) {
        if (run.status !== 'running' || run.leaseUntil === null) continue;
        if (run.leaseUntil.getTime() >= at.getTime()) continue;
        runs.set(run.id, {
          ...run,
          status: 'failed',
          errorCode,
          errorMessage,
          finishedAt: at,
          leaseUntil: null,
        });
        count += 1;
      }
      return count;
    },
  };
}

export interface MemoryTeamMemory extends TeamMemoryStore {
  readonly entries: () => readonly MemoryEntry[];
}

export function createMemoryTeamMemory(options?: { now?: () => Date }): MemoryTeamMemory {
  const now = options?.now ?? ((): Date => new Date());
  const entries = new Map<string, MemoryEntry>();
  let counter = 0;
  const inside = (entry: MemoryEntry, readable: readonly string[]): boolean =>
    entry.apps.every((app) => readable.includes(app));
  const newest = (a: MemoryEntry, b: MemoryEntry): number =>
    b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id);
  return {
    entries: () => [...entries.values()],
    async remember(input) {
      counter += 1;
      const entry: MemoryEntry = {
        ...input,
        apps: [...new Set(input.apps)].sort(),
        id: `10000000-0000-4000-8000-${counter.toString(16).padStart(12, '0')}`,
        createdAt: new Date(now().getTime() + counter),
      };
      entries.set(entry.id, entry);
      return entry;
    },
    async recall({ query, readableApps, limit }) {
      const words = query
        .toLowerCase()
        .split(/\s+/)
        .filter((word) => word !== '');
      return [...entries.values()]
        .filter((entry) => inside(entry, readableApps))
        .filter((entry) => words.some((word) => entry.text.toLowerCase().includes(word)))
        .sort(newest)
        .slice(0, limit);
    },
    async list({ authors, readableApps, limit }) {
      return [...entries.values()]
        .filter((entry) => inside(entry, readableApps))
        .filter((entry) => authors === undefined || authors.includes(entry.author))
        .sort(newest)
        .slice(0, limit);
    },
    async findById(id) {
      return entries.get(id) ?? null;
    },
    async forget(id) {
      return entries.delete(id);
    },
  };
}
