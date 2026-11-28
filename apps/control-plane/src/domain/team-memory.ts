/**
 * Team-Gedaechtnis (ADR 0024 F): `remember`, `recall`, `forget`,
 * `list_memories`, fuer Plattform-Agents und externe Agents gleich.
 *
 * **Wer liest:** Jeder Eintrag traegt seine Herkunft, die Apps, deren Inhalte
 * dazu beitrugen. Ein Aufrufer sieht einen Eintrag nur, wenn er **alle**
 * diese Apps jetzt lesen darf; ein Lauf prueft das mit seinen geschnittenen
 * Rechten (`run-rights.ts`), bei externem Anbieter also ohne die lokalen
 * Apps. Der Speicher bekommt die lesbaren Apps als Pflichtargument, die
 * Domaene prueft sein Ergebnis noch einmal.
 *
 * **Herkunft beim Merken:**
 *
 * - In einem Lauf: alle Apps, deren Inhalte der Lauf bis dahin gesehen hat
 *   (`RunScope.usedApps`), dazu was der Agent angibt. Er kann sie nicht
 *   verkleinern.
 * - Ein externer Agent: Die Plattform sieht seine frueheren Aufrufe nicht.
 *   Herkunft sind deshalb **alle Apps, die er beim Merken lesen darf**, dazu
 *   seine Angabe. Das zeigt einen Eintrag weniger Leuten, nie mehr.
 *
 * Freigaben: `execute` auf `tool:platform.remember` bzw.
 * `tool:platform.recall` (Default-Deny). Menschen mit `write` auf
 * `agent:<name>` sehen und loeschen Eintraege dieses Agenten, auch ohne
 * `recall`, aber auch sie nur mit Lesezugriff auf alle Herkunfts-Apps.
 */

import { canAccessApp } from './apps';
import { audited } from './audit';
import { can, requirePermission } from './can';
import type { DomainContext } from './context';
import {
  NotConfiguredError,
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
} from './errors';
import { PLATFORM_TARGET } from './events';
import type { MemoryEntry, TeamMemoryStore } from './ports';
import { readableAppsFor } from './readable-apps';
import type { Actor, ResourceRef } from './types';

export const MEMORY_LIMITS = Object.freeze({
  textMax: 4000,
  queryMin: 2,
  queryMax: 200,
  recallDefault: 10,
  recallMax: 50,
  listDefault: 50,
  listMax: 200,
  appsMax: 50,
});

const REMEMBER: ResourceRef = { kind: 'tool', id: `${PLATFORM_TARGET}.remember` };
const RECALL: ResourceRef = { kind: 'tool', id: `${PLATFORM_TARGET}.recall` };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const APP_NAME = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;

/** Was ein Lauf beim Merken mitgibt. */
export interface MemoryRunScope {
  readonly runId: string;
  usedApps(): readonly string[];
}

export interface MemoryView {
  readonly id: string;
  readonly author: string;
  readonly text: string;
  readonly apps: readonly string[];
  readonly runId: string | null;
  readonly createdAt: string;
}

function storeOf(ctx: DomainContext): TeamMemoryStore {
  if (ctx.memories === undefined) {
    throw new NotConfiguredError('the team memory is not available on this control plane');
  }
  return ctx.memories;
}

function toView(entry: MemoryEntry): MemoryView {
  return {
    id: entry.id,
    author: entry.author,
    text: entry.text,
    apps: entry.apps,
    runId: entry.runId,
    createdAt: entry.createdAt.toISOString(),
  };
}

function limitOf(value: unknown, fallback: number, max: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) {
    throw new ValidationError(`limit must be a whole number from 1 to ${String(max)}`);
  }
  return value;
}

/** Ist jede Herkunfts-App in `readable`? Leere Herkunft: ja. */
function covered(entry: MemoryEntry, readable: ReadonlySet<string>): boolean {
  return entry.apps.every((app) => readable.has(app));
}

/** `remember`: ein Eintrag mit Herkunft. Nur Agents. */
export async function remember(
  ctx: DomainContext,
  input: {
    readonly actor: Actor;
    readonly text: unknown;
    readonly apps?: unknown;
    readonly run?: MemoryRunScope;
    readonly correlationId?: string;
  },
): Promise<MemoryView> {
  return audited(
    ctx,
    {
      actor: input.actor,
      action: 'remember',
      resource: REMEMBER,
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    },
    async () => {
      if (input.actor.kind !== 'agent') {
        throw new PermissionDeniedError('only agents write to the team memory');
      }
      await requirePermission(ctx, input.actor, 'execute', REMEMBER);
      const store = storeOf(ctx);
      const text = input.text;
      if (typeof text !== 'string' || text.trim() === '' || text.length > MEMORY_LIMITS.textMax) {
        throw new ValidationError(
          `text must have 1 to ${String(MEMORY_LIMITS.textMax)} characters`,
        );
      }
      const declared = input.apps ?? [];
      if (
        !Array.isArray(declared) ||
        declared.length > MEMORY_LIMITS.appsMax ||
        !declared.every((app) => typeof app === 'string' && APP_NAME.test(app))
      ) {
        throw new ValidationError(
          `apps must be a list of at most ${String(MEMORY_LIMITS.appsMax)} app names`,
        );
      }
      // Eine Angabe darf die Herkunft nur vergroessern, und nur um Apps, die
      // der Aufrufer lesen darf: Sonst koennte er Eintraege vor Leuten
      // verstecken, die dieselben Apps lesen wie er.
      for (const name of declared as string[]) {
        const app = await ctx.apps.findByName(name);
        if (
          app === null ||
          app.archivedAt !== null ||
          !(await canAccessApp(ctx, input.actor, 'read', app))
        ) {
          throw new ValidationError(`apps: "${name}" is not an app you may read`);
        }
      }
      const base =
        input.run === undefined ? await readableAppsFor(ctx, input.actor) : input.run.usedApps();
      const apps = [...new Set([...base, ...(declared as string[])])].sort();
      const entry = await store.remember({
        author: input.actor.id,
        text: text.trim(),
        apps,
        runId: input.run?.runId ?? null,
      });
      return {
        value: toView(entry),
        detail: { memoryId: entry.id, apps, runId: entry.runId, length: entry.text.length },
      };
    },
  );
}

/** `recall`: Eintraege zur Anfrage, die der Aufrufer ganz lesen darf. */
export async function recall(
  ctx: DomainContext,
  input: {
    readonly actor: Actor;
    readonly query: unknown;
    readonly limit?: unknown;
    readonly correlationId?: string;
  },
): Promise<{ readonly memories: readonly MemoryView[] }> {
  return audited(
    ctx,
    {
      actor: input.actor,
      action: 'recall',
      resource: RECALL,
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    },
    async () => {
      if (input.actor.kind !== 'agent' && input.actor.kind !== 'user') {
        throw new PermissionDeniedError(`${input.actor.kind}:${input.actor.id} may not recall`);
      }
      await requirePermission(ctx, input.actor, 'execute', RECALL);
      const store = storeOf(ctx);
      const query = typeof input.query === 'string' ? input.query.trim() : '';
      if (query.length < MEMORY_LIMITS.queryMin || query.length > MEMORY_LIMITS.queryMax) {
        throw new ValidationError(
          `query must have ${String(MEMORY_LIMITS.queryMin)} to ${String(MEMORY_LIMITS.queryMax)} characters`,
        );
      }
      const limit = limitOf(input.limit, MEMORY_LIMITS.recallDefault, MEMORY_LIMITS.recallMax);
      const readable = await readableAppsFor(ctx, input.actor);
      const allowed = new Set(readable);
      const entries = (await store.recall({ query, readableApps: readable, limit })).filter(
        (entry) => covered(entry, allowed),
      );
      return {
        value: { memories: entries.map(toView) },
        detail: { returned: entries.length },
      };
    },
  );
}

/**
 * `list_memories`: neueste Eintraege. Mit `agent` die eines Agenten, fuer
 * wer `write` auf ihn hat oder er selbst ist; ohne `agent` alle, die der
 * Aufrufer lesen darf, mit `recall`-Freigabe.
 */
export async function listMemories(
  ctx: DomainContext,
  input: {
    readonly actor: Actor;
    readonly agent?: unknown;
    readonly limit?: unknown;
    readonly correlationId?: string;
  },
): Promise<{ readonly memories: readonly MemoryView[] }> {
  return audited(
    ctx,
    {
      actor: input.actor,
      action: 'list_memories',
      resource: RECALL,
      detail: { agent: typeof input.agent === 'string' ? input.agent : null },
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    },
    async () => {
      if (input.actor.kind !== 'agent' && input.actor.kind !== 'user') {
        throw new PermissionDeniedError(
          `${input.actor.kind}:${input.actor.id} may not list memories`,
        );
      }
      const store = storeOf(ctx);
      const limit = limitOf(input.limit, MEMORY_LIMITS.listDefault, MEMORY_LIMITS.listMax);
      const agent = input.agent === undefined || input.agent === '' ? null : input.agent;
      if (agent !== null && typeof agent !== 'string') {
        throw new ValidationError('agent must be the name of an agent');
      }
      if (agent === null) {
        await requirePermission(ctx, input.actor, 'execute', RECALL);
      } else {
        const self = input.actor.kind === 'agent' && input.actor.id === agent;
        const manages = await can(ctx, input.actor, 'write', { kind: 'agent', id: agent });
        if (!self && !manages) {
          throw new PermissionDeniedError(
            `${input.actor.kind}:${input.actor.id} may not list the memories of agent:${agent}`,
          );
        }
      }
      const readable = await readableAppsFor(ctx, input.actor);
      const allowed = new Set(readable);
      const entries = (
        await store.list({
          ...(agent === null ? {} : { authors: [agent] }),
          readableApps: readable,
          limit,
        })
      ).filter((entry) => covered(entry, allowed));
      return { value: { memories: entries.map(toView) }, detail: { returned: entries.length } };
    },
  );
}

/**
 * `forget`: loescht hart. Darf der Agent, der es sich gemerkt hat (mit
 * `remember`-Freigabe), oder wer `write` auf ihn hat, und beide nur einen
 * Eintrag, den sie sehen.
 */
export async function forget(
  ctx: DomainContext,
  input: { readonly actor: Actor; readonly id: unknown; readonly correlationId?: string },
): Promise<{ readonly forgotten: boolean }> {
  const id = typeof input.id === 'string' ? input.id : '';
  return audited(
    ctx,
    {
      actor: input.actor,
      action: 'forget',
      resource: REMEMBER,
      detail: { memoryId: id },
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    },
    async () => {
      const store = storeOf(ctx);
      if (!UUID.test(id)) throw new ValidationError('id must be the id of a memory');
      const entry = await store.findById(id);
      const readable = new Set(await readableAppsFor(ctx, input.actor));
      if (entry === null || !covered(entry, readable)) throw new NotFoundError('no such memory');
      const author =
        input.actor.kind === 'agent' &&
        input.actor.id === entry.author &&
        (await can(ctx, input.actor, 'execute', REMEMBER));
      const manages = await can(ctx, input.actor, 'write', { kind: 'agent', id: entry.author });
      if (!author && !manages) {
        throw new PermissionDeniedError(
          `${input.actor.kind}:${input.actor.id} may not forget memories of agent:${entry.author}`,
        );
      }
      const forgotten = await store.forget(id);
      return { value: { forgotten }, detail: { forgotten } };
    },
  );
}
