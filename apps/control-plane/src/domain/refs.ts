/**
 * Verweise zwischen Apps (ADR 0023).
 *
 * ## Aufloesen (`resolve_refs`, Abschnitt B)
 *
 * Die Control Plane loest auf, nie die App selbst. Je Verweis prueft sie bei
 * **jedem** Aufruf, ob der Betrachter die Ziel-App lesen darf, und ruft erst
 * dann den Resolver der App, direkt am Container wie fuer Agents (ADR 0011),
 * mit der Identitaet des Betrachters:
 *
 * - **Mensch:** `read` auf die App, wie die Forward-Auth.
 * - **Agent:** `read` auf die App **und** `execute` auf ihren Resolver, wie
 *   bei der Suche (ADR 0021). Ohne die zweite Freigabe kaeme ein Agent ueber
 *   die Plattform an ein Tool, das ihm niemand freigegeben hat.
 * - **App, Gruppe:** nie (ADR 0023: kein Aufruf im Namen einer Person).
 *
 * Wer nicht lesen darf, bekommt `restricted`, ohne Titel und ohne App-Namen;
 * dasselbe fuer eine App, die es nicht gibt, damit niemand am Ergebnis
 * erkennt, welche Apps es gibt. Ein Cache (60 s je Verweis) spart Aufrufe an
 * die App; die Rechtepruefung liegt **davor** und laeuft bei jedem Aufruf.
 * Ein Widerruf wirkt also sofort, ein neuer Titel nach spaetestens 60 s.
 *
 * ## Melden und Rueckverweise (`set_refs`, `list_backlinks`, Abschnitt C)
 *
 * Eine App meldet die vollstaendige Menge der ausgehenden Verweise eines
 * **eigenen** Objekts; die Quell-App kommt aus der geprueften Identitaet.
 * Rueckverweise sieht nur, wer Ziel- und Quell-App lesen darf.
 *
 * ## Erwaehnungen (Abschnitt D)
 *
 * Kommt in `set_refs` ein Subjekt neu hinzu, legt die Plattform
 * `platform.mentioned` im Eingang an, ueber denselben Weg wie `emit_event`:
 * nur fuer Subjekte mit `read` auf der Quell-App. `list_people` liefert dem
 * Picker die Menschen und Agents mit `read` auf eine App, und nur an
 * jemanden, der diese App selbst lesen darf.
 *
 * ## Aktionen (Abschnitt E)
 *
 * `list_actions` nennt die Aktionen „aus X wird Y“, die der Betrachter
 * ausfuehren kann: ein Mensch, wenn er Quelle und Ziel-App lesen darf, mit
 * einer Adresse in der Ziel-App, wo er unter seiner eigenen Identitaet
 * bestaetigt; ein Agent mit `execute` auf das Tool.
 *
 * Die Rechteregeln stehen hier und in `can.ts`, nirgends in einer App.
 */

import { createHash } from 'node:crypto';
import {
  normalizeResolveResult,
  parseObjectRef,
  parseRef,
  parseSetRefs,
  RefsInputError,
  REFS_LIMITS,
  type ObjectRef,
  type ParsedRef,
  type ResolvedObject,
  type SetRefsPayload,
} from '@openapps/sdk';
import { startMentionRuns } from './agent-runs';
import type { AppToolInvoker, HumanIdentity } from './app-tools';
import { canAccessApp } from './apps';
import { audited, record } from './audit';
import { can, requirePermission } from './can';
import type { DomainContext } from './context';
import { DomainError, PermissionDeniedError, ValidationError } from './errors';
import { callerApp, PLATFORM_TARGET, storeMention } from './events';
import { gatewayAppHref } from './platform-search';
import type { IncomingRef, RefRepository, StoredRefKind, StoredRefTarget } from './ports';
import type { Actor, App, SubjectRef } from './types';

export const REF_RESOLVE_LIMITS = Object.freeze({
  /** Hoechstens so viele Verweise je `resolve_refs`. */
  refs: 100,
  /** Ids je Aufruf eines Resolvers; mehr werden auf mehrere Aufrufe verteilt. */
  idsPerCall: REFS_LIMITS.resolveIds,
  /** Frist je Aufruf eines Resolvers in Millisekunden. */
  timeoutMs: 2000,
  /** So lange haelt der Cache einen aufgeloesten Verweis. */
  cacheTtlMs: 60_000,
  /** Hoechstens so viele Eintraege im Cache; aelteste gehen zuerst. */
  cacheMax: 5000,
});

export const REF_LIST_LIMITS = Object.freeze({
  backlinks: 200,
  peopleDefault: 10,
  peopleMax: 20,
  /** Kandidaten je Gruppe beim Durchsuchen der Mitglieder. */
  groupMembersMax: 1000,
  queryMax: 100,
  excerptMax: 500,
});

/* -------------------------------------------------------------------------- */
/* Ergebnis-Typen                                                              */
/* -------------------------------------------------------------------------- */

export type RefState = 'resolved' | 'restricted' | 'not_found' | 'unavailable';

/** Ein aufgeloester Objekt-Verweis. */
export interface ResolvedObjectRef {
  readonly ref: string;
  readonly state: 'resolved';
  readonly kind: 'object';
  readonly app: string;
  readonly appTitle: string;
  readonly type: string;
  readonly id: string;
  readonly title: string;
  /** Pfad in der App. */
  readonly path: string;
  /** Volle Adresse zum Oeffnen, oder `null` ohne Domain. */
  readonly href: string | null;
  readonly status?: string;
  readonly updatedAt: string;
}

/** Ein Subjekt-Verweis: nur, was der Verweis selbst schon sagt. */
export interface ResolvedSubjectRef {
  readonly ref: string;
  readonly state: 'resolved';
  readonly kind: 'human' | 'group' | 'agent';
  readonly title: string;
}

/**
 * Nicht aufgeloest. **Nur** der Verweis, den der Aufrufer selbst geschickt
 * hat, und der Zustand: kein Titel, kein App-Name, kein Hinweis darauf, ob
 * es die App gibt.
 */
export interface UnresolvedRef {
  readonly ref: string;
  readonly state: 'restricted' | 'not_found' | 'unavailable';
}

export type RefResolution = ResolvedObjectRef | ResolvedSubjectRef | UnresolvedRef;

export interface ResolveRefsResult {
  /** In der Reihenfolge der Anfrage, Doppel einmal. */
  readonly results: readonly RefResolution[];
}

/* -------------------------------------------------------------------------- */
/* Cache                                                                       */
/* -------------------------------------------------------------------------- */

/** Was der Cache je Verweis haelt: das Objekt oder „gibt es nicht“. */
export type CachedResolution =
  | { readonly found: true; readonly object: ResolvedObject }
  | { readonly found: false };

/**
 * Cache der Resolver-Antworten (ADR 0023 B). Er haelt nur, was die App
 * geantwortet hat, nie eine Rechteentscheidung: Die Pruefung liegt vor jedem
 * Blick in den Cache.
 */
export interface RefCache {
  get(key: string, now: number): CachedResolution | undefined;
  set(key: string, value: CachedResolution, now: number): void;
}

/** Ein Cache im Prozess mit fester Frist und Obergrenze. */
export function createRefCache(
  options: { readonly ttlMs?: number; readonly max?: number } = {},
): RefCache & { readonly size: number; clear(): void } {
  const ttlMs = options.ttlMs ?? REF_RESOLVE_LIMITS.cacheTtlMs;
  const max = options.max ?? REF_RESOLVE_LIMITS.cacheMax;
  const entries = new Map<string, { value: CachedResolution; expires: number }>();
  return {
    get size() {
      return entries.size;
    },
    clear() {
      entries.clear();
    },
    get(key, now) {
      const entry = entries.get(key);
      if (entry === undefined) return undefined;
      if (entry.expires <= now) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value, now) {
      entries.delete(key);
      entries.set(key, { value, expires: now + ttlMs });
      while (entries.size > max) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Hilfen                                                                      */
/* -------------------------------------------------------------------------- */

/** Der Resolver einer Objektart: im Manifest benannt, angeboten und lesend. */
export function resolverOf(app: Pick<App, 'manifest'>, type: string): string | null {
  const entry = (app.manifest.objects ?? []).find((object) => object.type === type);
  if (entry === undefined) return null;
  const offered = app.manifest.offeredTools.find((tool) => tool.name === entry.resolver);
  return offered !== undefined && offered.verb === 'read' ? entry.resolver : null;
}

/** Mensch oder Agent; sonst darf der Aufrufer diese Tools nicht. */
function requireViewer(actor: Actor, what: string): void {
  if (actor.kind !== 'user' && actor.kind !== 'agent') {
    throw new PermissionDeniedError(
      `${actor.kind}:${actor.id} may not ${what}: references are for people and agents`,
    );
  }
}

function requireOwnSession(actor: Actor, humanIdentity: HumanIdentity | undefined): void {
  if (actor.kind === 'user' && (humanIdentity === undefined || humanIdentity.userId !== actor.id)) {
    throw new PermissionDeniedError('a person resolves references only with their own session');
  }
}

/** Eine App, die es gibt und die nicht archiviert ist, sonst `null`. */
async function liveApp(ctx: DomainContext, name: string): Promise<App | null> {
  const app = await ctx.apps.findByName(name);
  return app === null || app.archivedAt !== null ? null : app;
}

function hrefFor(
  app: App,
  path: string,
  appHref: ((app: App) => string | null) | undefined,
): string | null {
  const base = (appHref ?? gatewayAppHref)(app);
  return base === null ? null : `${base.replace(/\/+$/, '')}${path}`;
}

function refsOf(ctx: DomainContext): RefRepository {
  if (ctx.refs === undefined) {
    throw new DomainError('references are not configured on this control plane', 'not_configured');
  }
  return ctx.refs;
}

class ResolverTimeout extends Error {}

/* -------------------------------------------------------------------------- */
/* resolve_refs                                                                */
/* -------------------------------------------------------------------------- */

export interface ResolveRefsInput {
  readonly actor: Actor;
  /** Pflicht fuer einen Menschen: seine Identitaet aus der Session. */
  readonly humanIdentity?: HumanIdentity;
  readonly refs: unknown;
  readonly invoker: AppToolInvoker;
  /** Ohne Cache fragt jeder Aufruf die App. */
  readonly cache?: RefCache;
  /** Frist je Resolver-Aufruf. Default 2000 ms. */
  readonly timeoutMs?: number;
  /** Andere Adresse der Apps (lokaler Betrieb), wie bei der Suche. */
  readonly appHref?: (app: App) => string | null;
  readonly correlationId?: string;
}

/** Die Verweise der Anfrage, geprueft: eine Liste von Texten, hoechstens 100. */
export function parseRefList(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > REF_RESOLVE_LIMITS.refs ||
    !value.every((entry) => typeof entry === 'string' && entry.length <= 400)
  ) {
    throw new ValidationError(
      `refs must be a list of 1 to ${String(REF_RESOLVE_LIMITS.refs)} references`,
    );
  }
  return [...new Set(value as string[])];
}

/**
 * Darf dieser Betrachter Objekte dieser App aufloesen? Eine Stelle fuer
 * Chips, REST-Route und MCP-Tool.
 */
export async function mayResolveIn(
  ctx: DomainContext,
  actor: Actor,
  app: App,
  resolver: string | null,
): Promise<boolean> {
  if (actor.kind !== 'user' && actor.kind !== 'agent') return false;
  if (!(await canAccessApp(ctx, actor, 'read', app))) return false;
  if (actor.kind === 'user') return true;
  if (resolver === null) return true;
  return can(ctx, actor, 'execute', { kind: 'tool', id: `${app.name}.${resolver}` });
}

function subjectResolution(parsed: Extract<ParsedRef, { kind: 'subject' }>): ResolvedSubjectRef {
  return { ref: parsed.ref, state: 'resolved', kind: parsed.subjectKind, title: parsed.id };
}

/**
 * Der Kern ohne Rechte: loest Objekt-Verweise einer App auf, mit Cache und
 * Frist. Fuer `resolveRefs` und den lokalen Ansehen-Proxy. Wirft nie wegen
 * der App; was nicht ging, ist `unavailable`.
 */
export async function resolveInApp(input: {
  readonly app: App;
  readonly refs: readonly ObjectRef[];
  readonly call: (
    tool: string,
    args: { readonly type: string; readonly ids: readonly string[] },
    signal: AbortSignal,
  ) => Promise<unknown>;
  readonly cache?: RefCache;
  readonly now: number;
  readonly timeoutMs: number;
  readonly appHref?: (app: App) => string | null;
}): Promise<Map<string, RefResolution>> {
  const { app } = input;
  const out = new Map<string, RefResolution>();
  const done = (ref: ObjectRef, object: ResolvedObject | null): void => {
    out.set(
      ref.ref,
      object === null
        ? { ref: ref.ref, state: 'not_found' }
        : {
            ref: ref.ref,
            state: 'resolved',
            kind: 'object',
            app: app.name,
            appTitle: app.displayName,
            type: ref.type,
            id: ref.id,
            title: object.title,
            path: object.path,
            href: hrefFor(app, object.path, input.appHref),
            ...(object.status === undefined ? {} : { status: object.status }),
            updatedAt: object.updatedAt,
          },
    );
  };

  const byType = new Map<string, ObjectRef[]>();
  for (const ref of input.refs) {
    if (resolverOf(app, ref.type) === null) {
      out.set(ref.ref, { ref: ref.ref, state: 'not_found' });
      continue;
    }
    if (app.primaryDomain === null) {
      out.set(ref.ref, { ref: ref.ref, state: 'unavailable' });
      continue;
    }
    const cached = input.cache?.get(ref.ref, input.now);
    if (cached !== undefined) {
      done(ref, cached.found ? cached.object : null);
      continue;
    }
    const list = byType.get(ref.type) ?? [];
    list.push(ref);
    byType.set(ref.type, list);
  }

  const calls: Promise<void>[] = [];
  for (const [type, refs] of byType) {
    const tool = resolverOf(app, type);
    if (tool === null) continue;
    for (let start = 0; start < refs.length; start += REF_RESOLVE_LIMITS.idsPerCall) {
      const chunk = refs.slice(start, start + REF_RESOLVE_LIMITS.idsPerCall);
      calls.push(
        (async () => {
          const controller = new AbortController();
          let timer: ReturnType<typeof setTimeout> | undefined;
          const deadline = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(new ResolverTimeout());
            }, input.timeoutMs);
          });
          try {
            const ids = chunk.map((ref) => ref.id);
            const value = await Promise.race([
              input.call(tool, { type, ids }, controller.signal),
              deadline,
            ]);
            const found = normalizeResolveResult(value, ids);
            if (found === null) {
              for (const ref of chunk) out.set(ref.ref, { ref: ref.ref, state: 'unavailable' });
              return;
            }
            for (const ref of chunk) {
              const object = found.get(ref.id) ?? null;
              input.cache?.set(
                ref.ref,
                object === null ? { found: false } : { found: true, object },
                input.now,
              );
              done(ref, object);
            }
          } catch (error) {
            if (!(error instanceof ResolverTimeout)) {
              console.error(
                `[refs] ${app.name}:`,
                error instanceof Error ? error.message.slice(0, 200) : 'failed',
              );
            }
            for (const ref of chunk) out.set(ref.ref, { ref: ref.ref, state: 'unavailable' });
          } finally {
            if (timer !== undefined) clearTimeout(timer);
            controller.abort();
          }
        })(),
      );
    }
  }
  await Promise.all(calls);
  return out;
}

/** `resolve_refs`, `GET /api/refs/resolve`, `GET /_platform/refs/resolve`. */
export async function resolveRefs(
  ctx: DomainContext,
  input: ResolveRefsInput,
): Promise<ResolveRefsResult> {
  return audited(
    ctx,
    {
      actor: input.actor,
      action: 'resolve_refs',
      resource: null,
      detail: { count: Array.isArray(input.refs) ? input.refs.length : 0 },
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    },
    async () => {
      const { actor } = input;
      requireViewer(actor, 'resolve references');
      requireOwnSession(actor, input.humanIdentity);
      const refs = parseRefList(input.refs);

      const results = new Map<string, RefResolution>();
      const byApp = new Map<string, ObjectRef[]>();
      for (const value of refs) {
        const parsed = parseRef(value);
        if (parsed === null) {
          results.set(value, { ref: value, state: 'not_found' });
        } else if (parsed.kind === 'subject') {
          results.set(value, { ...subjectResolution(parsed), ref: value });
        } else {
          const list = byApp.get(parsed.app) ?? [];
          list.push(parsed);
          byApp.set(parsed.app, list);
        }
      }

      const now = ctx.clock.now().getTime();
      const timeoutMs = input.timeoutMs ?? REF_RESOLVE_LIMITS.timeoutMs;
      await Promise.all(
        [...byApp.entries()].map(async ([name, appRefs]) => {
          const restricted = (ref: ObjectRef) =>
            results.set(ref.ref, { ref: ref.ref, state: 'restricted' });
          const app = await liveApp(ctx, name);
          if (app === null) {
            appRefs.forEach(restricted);
            return;
          }
          // Je Objektart, weil ein Agent je Resolver eine Freigabe braucht.
          const allowed: ObjectRef[] = [];
          const decided = new Map<string, boolean>();
          for (const ref of appRefs) {
            let ok = decided.get(ref.type);
            if (ok === undefined) {
              ok = await mayResolveIn(ctx, actor, app, resolverOf(app, ref.type));
              decided.set(ref.type, ok);
            }
            if (ok) allowed.push(ref);
            else restricted(ref);
          }
          if (allowed.length === 0) return;
          const resolved = await resolveInApp({
            app,
            refs: allowed,
            now,
            timeoutMs,
            ...(input.cache === undefined ? {} : { cache: input.cache }),
            ...(input.appHref === undefined ? {} : { appHref: input.appHref }),
            call: (tool, args, signal) =>
              input.invoker.invoke({
                app,
                toolName: tool,
                actor,
                args: { type: args.type, ids: [...args.ids] },
                // Ein Resolver bekommt nichts aus anderen Apps zu sehen.
                readableApps: null,
                ...(input.humanIdentity === undefined
                  ? {}
                  : { humanIdentity: input.humanIdentity }),
                signal,
              }),
          });
          for (const [ref, resolution] of resolved) results.set(ref, resolution);
        }),
      );

      const ordered = refs.map(
        (ref): RefResolution => results.get(ref) ?? { ref, state: 'unavailable' },
      );
      const count = (state: RefState) => ordered.filter((r) => r.state === state).length;
      return {
        value: { results: ordered },
        detail: {
          resolved: count('resolved'),
          restricted: count('restricted'),
          notFound: count('not_found'),
          unavailable: count('unavailable'),
        },
      };
    },
  );
}

/* -------------------------------------------------------------------------- */
/* set_refs                                                                    */
/* -------------------------------------------------------------------------- */

export interface SetRefsOutcome {
  readonly status: 'applied' | 'stale';
  readonly targets: number;
  /** So viele Subjekte kamen neu hinzu und wurden zur Erwaehnung gemeldet. */
  readonly mentioned: number;
}

const MENTION_AUDIENCE_MAX = 50;

/** Ein Text auf eine Zeile, gekuerzt, fuer den Titel der Erwaehnung. */
function mentionTitle(payload: SetRefsPayload, app: App): string {
  const where = payload.title ?? app.displayName;
  const text = `Mentioned in ${where}`;
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}

/**
 * `set_refs` (Plattform-Tool fuer Apps). Wirft `PermissionDeniedError` ohne
 * Freigabe oder fuer ein fremdes Objekt, `ValidationError` bei falscher Form
 * oder einer Objektart, die das Manifest nicht erklaert. Ablehnungen stehen
 * im Audit-Log; eine angenommene Meldung nicht (die Tabelle ist das
 * Protokoll), wie bei `emit_event`.
 */
export async function setRefs(
  ctx: DomainContext,
  input: {
    readonly actor: Actor;
    readonly args: Readonly<Record<string, unknown>>;
    readonly correlationId?: string;
  },
): Promise<SetRefsOutcome> {
  const resource = { kind: 'tool' as const, id: `${PLATFORM_TARGET}.set_refs` };
  try {
    await requirePermission(ctx, input.actor, 'execute', resource);
    const app = await callerApp(ctx, input.actor);
    const repo = refsOf(ctx);

    let payload: SetRefsPayload;
    try {
      payload = parseSetRefs(input.args, ctx.clock.now());
    } catch (error) {
      if (error instanceof RefsInputError) throw new ValidationError(error.message);
      throw error;
    }

    // Die Quell-App steht in der geprueften Identitaet, nicht in der Meldung.
    const source = parseObjectRef(payload.source);
    if (source === null || source.app !== app.name) {
      throw new PermissionDeniedError(
        `app:${app.name} reports references only for its own objects, not for ${payload.source}`,
      );
    }
    if (!(app.manifest.objects ?? []).some((object) => object.type === source.type)) {
      throw new ValidationError(
        `object type "${source.type}" is not declared under objects in the manifest of ${app.name}`,
      );
    }

    const targets: StoredRefTarget[] = payload.targets.map((target) => {
      const parsed = parseRef(target.ref);
      return {
        ref: target.ref,
        kind: target.kind as StoredRefKind,
        targetApp: parsed?.kind === 'object' ? parsed.app : null,
      };
    });
    const outcome = await repo.replace({
      source: payload.source,
      app: app.name,
      updatedAt: new Date(payload.updatedAt),
      targets,
    });
    if (outcome.status === 'stale') {
      return { status: 'stale', targets: targets.length, mentioned: 0 };
    }

    // Nur Subjekte, die neu dazukamen: dieselbe Menge noch einmal erzeugt nichts.
    const before = new Set(outcome.previous.filter((t) => t.kind === 'mention').map((t) => t.ref));
    const added = targets
      .filter((t) => t.kind === 'mention' && !before.has(t.ref))
      .map((t) => t.ref);
    for (let start = 0; start < added.length; start += MENTION_AUDIENCE_MAX) {
      const audience = added.slice(start, start + MENTION_AUDIENCE_MAX);
      const digest = createHash('sha256')
        .update(`${payload.source}\u0000${payload.updatedAt}\u0000${audience.join('\u0000')}`)
        .digest('hex')
        .slice(0, 40);
      const eventId = `mention.${digest}`;
      const stored = await storeMention(ctx, app, {
        id: eventId,
        object: payload.source,
        title: mentionTitle(payload, app),
        path: payload.path ?? '/',
        actor: payload.actor,
        audience,
        occurredAt: payload.updatedAt,
      });
      // ADR 0024 E: Ein erwaehnter Plattform-Agent, der die Erwaehnung
      // bekommen hat, startet genau einen Lauf. Ein Doppel bekommt keine
      // Empfaenger und startet nichts.
      const agents = (stored?.recipients ?? [])
        .filter((recipient) => recipient.kind === 'agent')
        .map((recipient) => recipient.id);
      if (stored?.status === 'accepted' && agents.length > 0) {
        try {
          await startMentionRuns(ctx, {
            app,
            eventId,
            source: payload.source,
            title: payload.title ?? null,
            path: payload.path ?? null,
            claimedActor: payload.actor,
            agents,
            ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
          });
        } catch (error) {
          // Die Verweise und die Erwaehnung stehen; ein Lauf ist eine Zugabe.
          console.error('[set_refs] mention runs not started', error);
        }
      }
    }
    return { status: 'applied', targets: targets.length, mentioned: added.length };
  } catch (error) {
    await record(ctx, {
      actor: input.actor,
      action: 'set_refs',
      resource,
      outcome: error instanceof PermissionDeniedError ? 'denied' : 'error',
      reason: error instanceof Error ? error.message : String(error),
      detail: {
        source: typeof input.args.source === 'string' ? input.args.source.slice(0, 400) : null,
      },
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    });
    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/* list_backlinks                                                              */
/* -------------------------------------------------------------------------- */

export interface Backlink {
  readonly source: string;
  readonly kind: StoredRefKind;
  readonly app: string;
  readonly appTitle: string;
  readonly updatedAt: string;
}

export interface BacklinksResult {
  readonly ref: string;
  readonly backlinks: readonly Backlink[];
}

/**
 * Der Kern ohne Aufrufer: eingehende Verweise, gefiltert durch `mayRead`
 * je Quell-App. Fuer `listBacklinks` und den lokalen Ansehen-Proxy.
 */
export async function filterBacklinks(input: {
  readonly incoming: readonly IncomingRef[];
  readonly findApp: (name: string) => Promise<App | null>;
  readonly mayRead: (app: App) => Promise<boolean>;
}): Promise<Backlink[]> {
  const decided = new Map<string, App | null>();
  const backlinks: Backlink[] = [];
  for (const entry of input.incoming) {
    if (!decided.has(entry.sourceApp)) {
      const app = await input.findApp(entry.sourceApp);
      decided.set(
        entry.sourceApp,
        app !== null && app.archivedAt === null && (await input.mayRead(app)) ? app : null,
      );
    }
    const app = decided.get(entry.sourceApp) ?? null;
    if (app === null) continue;
    backlinks.push({
      source: entry.source,
      kind: entry.kind,
      app: app.name,
      appTitle: app.displayName,
      updatedAt: entry.updatedAt.toISOString(),
    });
  }
  return backlinks;
}

/** `list_backlinks`, `GET /api/refs/backlinks`: nur, wenn beide Apps lesbar sind. */
export async function listBacklinks(
  ctx: DomainContext,
  input: { readonly actor: Actor; readonly ref: unknown; readonly correlationId?: string },
): Promise<BacklinksResult> {
  return audited(
    ctx,
    {
      actor: input.actor,
      action: 'list_backlinks',
      resource: null,
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    },
    async () => {
      requireViewer(input.actor, 'list backlinks');
      const target = parseObjectRef(input.ref);
      if (target === null) {
        throw new ValidationError('ref must be an object reference <app>:<type>:<id>');
      }
      const empty = { value: { ref: target.ref, backlinks: [] }, detail: { returned: 0 } };
      const targetApp = await liveApp(ctx, target.app);
      // Wer die Ziel-App nicht lesen darf, sieht nichts und erfaehrt nicht, ob es sie gibt.
      if (targetApp === null || !(await canAccessApp(ctx, input.actor, 'read', targetApp))) {
        return empty;
      }
      const incoming = await refsOf(ctx).listIncoming(target.ref, REF_LIST_LIMITS.backlinks);
      const backlinks = await filterBacklinks({
        incoming,
        findApp: (name) => ctx.apps.findByName(name),
        mayRead: (app) => canAccessApp(ctx, input.actor, 'read', app),
      });
      return {
        value: { ref: target.ref, backlinks },
        detail: { returned: backlinks.length, hidden: incoming.length - backlinks.length },
      };
    },
  );
}

/* -------------------------------------------------------------------------- */
/* list_people                                                                 */
/* -------------------------------------------------------------------------- */

export interface Person {
  /** Verweis zum Einfuegen: `human:<email>` oder `agent:<name>`. */
  readonly ref: string;
  readonly kind: 'human' | 'agent';
  /** Name oder E-Mail, Anzeigename des Agenten. */
  readonly label: string;
  /** E-Mail bei Menschen, Name bei Agents. */
  readonly detail: string;
}

export interface PeopleResult {
  readonly app: string;
  readonly people: readonly Person[];
}

function parseQuery(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > REF_LIST_LIMITS.queryMax) {
    throw new ValidationError(
      `q must be text of at most ${String(REF_LIST_LIMITS.queryMax)} characters`,
    );
  }
  return value.trim().toLowerCase();
}

function parsePeopleLimit(value: unknown): number {
  if (value === undefined || value === null) return REF_LIST_LIMITS.peopleDefault;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > REF_LIST_LIMITS.peopleMax
  ) {
    throw new ValidationError(
      `limit must be a whole number from 1 to ${String(REF_LIST_LIMITS.peopleMax)}`,
    );
  }
  return value;
}

/**
 * Die Menschen und Agents mit `read` auf die App, aus den offenen
 * Freigaben: direkt an eine Person, an eine Gruppe (ihre Mitglieder von
 * jetzt) oder an einen Agenten, auch ueber `app:*`. Gesperrte Agents fallen
 * weg. Kein Aufrufer, keine Pruefung: Die macht `listPeople` davor.
 */
export async function peopleWithRead(
  ctx: Pick<DomainContext, 'grants' | 'groups' | 'agents' | 'users'>,
  app: Pick<App, 'id' | 'name'>,
  options: { readonly query: string; readonly limit: number },
): Promise<Person[]> {
  const grants = (
    await Promise.all(
      [app.id, app.name, '*'].map((id) => ctx.grants.listForResource({ kind: 'app', id })),
    )
  )
    .flat()
    .filter((g) => g.revokedAt === null && g.verb === 'read');

  const people = new Map<string, Person>();
  const addHuman = async (email: string): Promise<void> => {
    const normalized = email.trim().toLowerCase();
    if (normalized === '' || people.has(`human:${normalized}`)) return;
    const user = (await ctx.users?.findByEmail(normalized)) ?? null;
    const name = user?.name.trim() ?? '';
    people.set(`human:${normalized}`, {
      ref: `human:${normalized}`,
      kind: 'human',
      label: name === '' ? normalized : name,
      detail: normalized,
    });
  };

  const subjects = new Map<string, SubjectRef>();
  for (const g of grants) subjects.set(`${g.subject.kind}:${g.subject.id}`, g.subject);
  for (const subject of subjects.values()) {
    if (subject.kind === 'user') {
      const user = (await ctx.users?.findById(subject.id)) ?? null;
      if (user !== null) await addHuman(user.email);
    } else if (subject.kind === 'group') {
      if ((await ctx.groups.findByName(subject.id)) === null) continue;
      const members = await ctx.groups.listMembers(subject.id);
      for (const member of members.slice(0, REF_LIST_LIMITS.groupMembersMax)) {
        await addHuman(member.email);
      }
    } else if (subject.kind === 'agent') {
      const agent = await ctx.agents.findByName(subject.id);
      if (agent === null || agent.disabledAt !== null) continue;
      people.set(`agent:${agent.name}`, {
        ref: `agent:${agent.name}`,
        kind: 'agent',
        label: agent.displayName.trim() === '' ? agent.name : agent.displayName,
        detail: agent.name,
      });
    }
  }

  return [...people.values()]
    .filter(
      (person) =>
        options.query === '' ||
        person.label.toLowerCase().includes(options.query) ||
        person.detail.toLowerCase().includes(options.query),
    )
    .sort((a, b) => a.label.localeCompare(b.label) || a.ref.localeCompare(b.ref))
    .slice(0, options.limit);
}

/**
 * `list_people`, `GET /api/people`: wer in einer App erwaehnt werden kann.
 * Nur fuer jemanden, der die App selbst lesen darf; sonst leer, ohne zu
 * sagen, ob es die App gibt.
 */
export async function listPeople(
  ctx: DomainContext,
  input: {
    readonly actor: Actor;
    readonly app: unknown;
    readonly q?: unknown;
    readonly limit?: unknown;
    readonly correlationId?: string;
  },
): Promise<PeopleResult> {
  return audited(
    ctx,
    {
      actor: input.actor,
      action: 'list_people',
      resource: typeof input.app === 'string' ? { kind: 'app', id: input.app.slice(0, 64) } : null,
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    },
    async () => {
      requireViewer(input.actor, 'list people');
      if (typeof input.app !== 'string' || input.app.length === 0 || input.app.length > 64) {
        throw new ValidationError('app must be an app name');
      }
      const query = parseQuery(input.q);
      const limit = parsePeopleLimit(input.limit);
      const app = await liveApp(ctx, input.app);
      if (app === null || !(await canAccessApp(ctx, input.actor, 'read', app))) {
        return { value: { app: input.app, people: [] }, detail: { returned: 0 } };
      }
      const people = await peopleWithRead(ctx, app, { query, limit });
      return { value: { app: app.name, people }, detail: { returned: people.length } };
    },
  );
}

/* -------------------------------------------------------------------------- */
/* list_actions                                                                */
/* -------------------------------------------------------------------------- */

export interface RefAction {
  readonly app: string;
  readonly appTitle: string;
  readonly name: string;
  readonly title: string;
  /** `<app>.<tool>`: fuer Agents ueber MCP, mit `execute`. */
  readonly tool: string;
  /**
   * Nur fuer Menschen: die Seite in der Ziel-App, mit `ref` und `excerpt`
   * als Parameter. Die Person bestaetigt dort unter ihrer eigenen Identitaet.
   */
  readonly href?: string;
}

export interface ActionsResult {
  readonly ref: string;
  readonly actions: readonly RefAction[];
}

/** Auszug fuer die Adresse: ohne Steuerzeichen ausser Zeilenumbruch, gekuerzt. */
export function cleanExcerpt(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new ValidationError('excerpt must be text');
  const cleaned = value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ')
    .trim();
  if (cleaned === '') return null;
  return cleaned.length > REF_LIST_LIMITS.excerptMax
    ? `${cleaned.slice(0, REF_LIST_LIMITS.excerptMax - 1)}…`
    : cleaned;
}

/** Die Adresse einer Aktion fuer eine Person: Pfad der Ziel-App plus `ref` und `excerpt`. */
export function actionHref(
  base: string,
  path: string,
  ref: string,
  excerpt: string | null,
): string {
  const params = new URLSearchParams({ ref });
  if (excerpt !== null) params.set('excerpt', excerpt);
  return `${base.replace(/\/+$/, '')}${path}?${params.toString()}`;
}

/**
 * Die Aktionen aller Apps, die diese Objektart annehmen, ohne Rechte. Fuer
 * `listActions` und den lokalen Ansehen-Proxy.
 */
export function actionsAccepting(
  apps: readonly App[],
  source: ObjectRef,
): { readonly app: App; readonly action: NonNullable<App['manifest']['actions']>[number] }[] {
  const kind = `${source.app}:${source.type}`;
  const found: { app: App; action: NonNullable<App['manifest']['actions']>[number] }[] = [];
  for (const app of [...apps].sort((a, b) => a.name.localeCompare(b.name))) {
    if (app.archivedAt !== null || app.primaryDomain === null) continue;
    for (const action of app.manifest.actions ?? []) {
      if (!action.accepts.includes(kind)) continue;
      if (!app.manifest.offeredTools.some((tool) => tool.name === action.tool)) continue;
      found.push({ app, action });
    }
  }
  return found;
}

/** `list_actions`, `GET /api/refs/actions`. */
export async function listActions(
  ctx: DomainContext,
  input: {
    readonly actor: Actor;
    readonly ref: unknown;
    readonly excerpt?: unknown;
    readonly appHref?: (app: App) => string | null;
    readonly correlationId?: string;
  },
): Promise<ActionsResult> {
  return audited(
    ctx,
    {
      actor: input.actor,
      action: 'list_actions',
      resource: null,
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    },
    async () => {
      const { actor } = input;
      requireViewer(actor, 'list actions');
      const source = parseObjectRef(input.ref);
      if (source === null) {
        throw new ValidationError('ref must be an object reference <app>:<type>:<id>');
      }
      const excerpt = cleanExcerpt(input.excerpt);
      const empty = { value: { ref: source.ref, actions: [] }, detail: { returned: 0 } };

      if (actor.kind === 'user') {
        // Eine Person bekommt nur Aktionen zu etwas, das sie selbst sehen darf.
        const sourceApp = await liveApp(ctx, source.app);
        if (sourceApp === null || !(await canAccessApp(ctx, actor, 'read', sourceApp))) {
          return empty;
        }
      }

      const actions: RefAction[] = [];
      for (const { app, action } of actionsAccepting(await ctx.apps.listAll(), source)) {
        const tool = `${app.name}.${action.tool}`;
        const entry = {
          app: app.name,
          appTitle: app.displayName,
          name: action.name,
          title: action.title,
          tool,
        };
        if (actor.kind === 'agent') {
          if (await can(ctx, actor, 'execute', { kind: 'tool', id: tool })) actions.push(entry);
          continue;
        }
        // Menschen: die Ziel-App oeffnen duerfen und eine Seite zum Bestaetigen.
        if (action.path === undefined) continue;
        if (!(await canAccessApp(ctx, actor, 'read', app))) continue;
        const base = (input.appHref ?? gatewayAppHref)(app);
        if (base === null) continue;
        actions.push({ ...entry, href: actionHref(base, action.path, source.ref, excerpt) });
      }
      return { value: { ref: source.ref, actions }, detail: { returned: actions.length } };
    },
  );
}
