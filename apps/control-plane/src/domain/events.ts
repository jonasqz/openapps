/**
 * Ereignisse, Benachrichtigungen und Abonnements (ADR 0022).
 *
 * ## Annehmen (`emit_event`, Abschnitt B)
 *
 * Eine App meldet ein Ereignis ueber den signierten Weg aus ADR 0020 an das
 * reservierte Ziel `platform`. Angenommen wird es nur,
 *
 * 1. mit der Freigabe `execute` auf `tool:platform.emit_event` (Default-Deny,
 *    auch fuer die eigenen Daten des Aufrufers), und
 * 2. wenn der Typ im Manifest der laufenden Version unter `events` steht.
 *
 * Ein Doppel (dieselbe Id der App) ist `duplicate`, kein Fehler. Angenommene
 * Ereignisse stehen in der Tabelle `events`, nicht im Audit-Log; nur
 * Ablehnungen kommen dorthin.
 *
 * ## Ableiten (Abschnitt C)
 *
 * Je Empfaenger eine Zeile in `notifications`. Gruppen werden zu ihren
 * Mitgliedern **zu diesem Zeitpunkt** aufgeloest; der Ausloeser bekommt
 * keine. **Erste Pruefung:** nur Subjekte mit `read` auf die Quell-App. Wer
 * nicht lesen darf, bekommt keine Zeile, und die App erfaehrt es nicht.
 *
 * ## Lesen (`list_inbox`, `mark_inbox`)
 *
 * **Zweite Pruefung** bei jedem Lesen: `read` auf die Quell-App, ohne Cache.
 * Ein Widerruf blendet die Zeilen beim naechsten Aufruf aus (sie bleiben in
 * der Tabelle, bis die Frist sie loescht). Beide Tools wirken nur auf den
 * Eingang des Aufrufers.
 *
 * ## Abonnements (`poll_events`, `ack_events`, Abschnitt E)
 *
 * Eine App ruft die Ereignisse ab, die ihr Manifest unter `subscriptions`
 * nennt, ab ihrem Cursor. Recht: `read` auf die Quell-App fuer `app:<name>`,
 * geprueft bei jedem Abruf und jeder Quittung.
 *
 * Die Rechteregeln stehen hier und in `can.ts`, nirgends in einer App.
 */

import { parsePlatformEvent, type PlatformEvent } from '@openapps/sdk';
import { audited, record } from './audit';
import { canAccessApp, subjectsCanAccessApp } from './apps';
import { requirePermission } from './can';
import type { DomainContext } from './context';
import { DomainError, NotFoundError, PermissionDeniedError, ValidationError } from './errors';
import { gatewayAppHref } from './platform-search';
import { embedForApp, generateForApp, modelInfoForApp } from './models';
import { setRefs } from './refs';
import type {
  EventImportance,
  EventRepository,
  EventSubscriptionRef,
  InboxOwner,
  InboxRow,
  NotificationRecipient,
  NotificationState,
  StoredEvent,
} from './ports';
import type { Actor, App, SubjectRef } from './types';

/** Das reservierte Ziel der Plattform-Tools fuer Apps (`callAppTool('platform', …)`). */
export const PLATFORM_TARGET = 'platform';

/**
 * Die Plattform-Tools, die eine **App** rufen kann. Jedes braucht `execute`
 * auf `tool:platform.<name>`. `list_inbox` und `mark_inbox` gehoeren nicht
 * dazu: Apps haben keinen Eingang.
 */
export const PLATFORM_APP_TOOLS: readonly string[] = Object.freeze([
  'emit_event',
  'poll_events',
  'ack_events',
  'set_refs',
  // ADR 0024 D: der Modell-Anbieter der Plattform fuer Apps.
  'generate',
  'embed',
]);

/**
 * Plattform-Tools fuer **Agents** mit eigener Freigabe (ADR 0024 F): das
 * Team-Gedaechtnis. Freigeben darf sie wie die Tools fuer Apps, wer dasselbe
 * Verb auf `app:*` hat. Eine App kann sie nicht rufen.
 */
export const PLATFORM_AGENT_TOOLS: readonly string[] = Object.freeze(['remember', 'recall']);

/**
 * Typen, die nur die Plattform selbst anlegt (ADR 0022 C, ADR 0023 D). Eine
 * App kann sie nicht melden, auch wenn ihr Manifest sie nennt.
 */
export const PLATFORM_EVENT_PREFIX = 'platform.';
export const MENTIONED_EVENT_TYPE = 'platform.mentioned';
/** Ein Lauf, den eine Erwaehnung ausgeloest hat, ist fertig (ADR 0024 E). */
export const AGENT_RUN_FINISHED_EVENT_TYPE = 'platform.agent_run_finished';

export const INBOX_LIMITS = Object.freeze({
  /** Eintraege ohne Angabe. */
  default: 50,
  max: 200,
  /** Hoechstens so viele Ids je `mark_inbox`. */
  markMax: 100,
  /** Hoechstens so viele Empfaenger je Ereignis, nach dem Aufloesen der Gruppen. */
  recipientsMax: 1000,
});

export const POLL_LIMITS = Object.freeze({ default: 100, max: 200 });

export const EVENTS_RETENTION_DAYS_DEFAULT = 90;

const IMPORTANCE_ORDER: Readonly<Record<EventImportance, number>> = {
  high: 0,
  normal: 1,
  low: 2,
};

/** Die Ereignis-Ablage, oder ein Fehler. Ohne sie nimmt die Plattform nichts an. */
function eventsOf(ctx: DomainContext): EventRepository {
  if (ctx.events === undefined) {
    throw new DomainError('events are not configured on this control plane', 'not_configured');
  }
  return ctx.events;
}

/* -------------------------------------------------------------------------- */
/* Annehmen                                                                    */
/* -------------------------------------------------------------------------- */

export type EmitOutcome = { readonly status: 'accepted' | 'duplicate' };

/** Die App des Aufrufers, registriert und nicht archiviert. */
export async function callerApp(ctx: DomainContext, actor: Actor): Promise<App> {
  if (actor.kind !== 'app') {
    throw new PermissionDeniedError(`${actor.kind}:${actor.id} is not an app`);
  }
  const app = await ctx.apps.findByName(actor.id);
  if (app === null || app.archivedAt !== null) {
    throw new PermissionDeniedError(`app "${actor.id}" is not registered`);
  }
  return app;
}

/**
 * `emit_event`. Wirft `PermissionDeniedError` (403) ohne Freigabe,
 * `ValidationError` (400) bei falscher Form oder einem Typ, den das Manifest
 * nicht erklaert. Beides steht im Audit-Log; das angenommene Ereignis nicht.
 */
export async function emitEvent(
  ctx: DomainContext,
  input: {
    readonly actor: Actor;
    readonly args: Readonly<Record<string, unknown>>;
    readonly correlationId?: string;
  },
): Promise<EmitOutcome> {
  const resource = { kind: 'tool' as const, id: `${PLATFORM_TARGET}.emit_event` };
  try {
    await requirePermission(ctx, input.actor, 'execute', resource);
    const app = await callerApp(ctx, input.actor);
    const repo = eventsOf(ctx);

    let event: PlatformEvent;
    try {
      event = parsePlatformEvent(input.args, ctx.clock.now());
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : 'invalid event');
    }

    if (event.type.startsWith(PLATFORM_EVENT_PREFIX)) {
      throw new ValidationError(`event type "${event.type}" is reserved for the platform`);
    }
    // Nur Typen aus dem Manifest der laufenden Version. Eine alte Freigabe
    // oeffnet keinen Typ, den die App nicht (mehr) erklaert.
    const declared = (app.manifest.events ?? []).find((entry) => entry.type === event.type);
    if (declared === undefined) {
      throw new ValidationError(
        `event type "${event.type}" is not declared in the manifest of ${app.name}`,
      );
    }

    const { status } = await storeEvent(ctx, repo, app, event, declared.importance);
    return { status };
  } catch (error) {
    await record(ctx, {
      actor: input.actor,
      action: 'emit_event',
      resource,
      outcome: error instanceof PermissionDeniedError ? 'denied' : 'error',
      reason: error instanceof Error ? error.message : String(error),
      detail: {
        type: typeof input.args.type === 'string' ? input.args.type.slice(0, 64) : null,
        id: typeof input.args.id === 'string' ? input.args.id.slice(0, 200) : null,
      },
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    });
    throw error;
  }
}

/**
 * Legt ein geprueftes Ereignis der App an und leitet die Benachrichtigungen
 * ab. Gemeinsamer Weg fuer `emit_event` und die Erwaehnungen der Plattform
 * (ADR 0023 D), damit beide dieselbe erste Pruefung haben.
 */
async function storeEvent(
  ctx: DomainContext,
  repo: EventRepository,
  app: App,
  event: PlatformEvent,
  importance: EventImportance,
): Promise<StoredOutcome> {
  if (await repo.exists(app.name, event.id)) return { status: 'duplicate', recipients: [] };
  const recipients = await deriveRecipients(ctx, app, event);
  const stored = await repo.insert(
    {
      app: app.name,
      eventId: event.id,
      type: event.type,
      object: event.object,
      title: event.title,
      path: event.path,
      actor: event.actor,
      audience: event.audience,
      importance,
      occurredAt: new Date(event.occurredAt),
    },
    recipients,
  );
  return stored === null
    ? { status: 'duplicate', recipients: [] }
    : { status: 'accepted', recipients };
}

/** Wie `EmitOutcome`, mit den Empfaengern, die eine Zeile bekamen. */
export interface StoredOutcome extends EmitOutcome {
  readonly recipients: readonly NotificationRecipient[];
}

/**
 * Eine Erwaehnung (ADR 0023 D): ein Ereignis `platform.mentioned` der
 * Quell-App an die neu erwaehnten Subjekte. Nur wer die Quell-App lesen
 * darf, bekommt eine Zeile; der Ausloeser nicht. Ohne Ereignis-Ablage
 * entsteht nichts (die Verweise selbst stehen trotzdem).
 */
export async function storeMention(
  ctx: DomainContext,
  app: App,
  input: PlatformNotice,
): Promise<StoredOutcome | null> {
  return storePlatformEvent(ctx, app, MENTIONED_EVENT_TYPE, input, 'high');
}

/** Was die Plattform selbst im Namen einer Quell-App meldet. */
export interface PlatformNotice {
  readonly id: string;
  readonly object: string;
  readonly title: string;
  readonly path: string;
  readonly actor: string | null;
  readonly audience: readonly string[];
  readonly occurredAt: string;
}

/**
 * Ein Ereignis mit einem Typ `platform.*` an der Quell-App: Erwaehnungen
 * (ADR 0023 D) und fertige Laeufe (ADR 0024 E). Dieselbe erste Pruefung wie
 * `emit_event`. Ohne Ereignis-Ablage entsteht nichts.
 */
export async function storePlatformEvent(
  ctx: DomainContext,
  app: App,
  type: string,
  input: PlatformNotice,
  importance: EventImportance,
): Promise<StoredOutcome | null> {
  if (ctx.events === undefined) return null;
  if (!type.startsWith(PLATFORM_EVENT_PREFIX)) {
    throw new ValidationError(`"${type}" is not a platform event type`);
  }
  const event = parsePlatformEvent(
    { ...input, type, audience: [...input.audience] },
    ctx.clock.now(),
  );
  return storeEvent(ctx, ctx.events, app, event, importance);
}

/** Ein Eingang als Schluessel, `human:<email>` oder `agent:<name>`. */
function ownerKey(owner: InboxOwner): string {
  return `${owner.kind}:${owner.id}`;
}

/** Aus einer Angabe (`human:`, `user:`, `agent:`) der Eingang, oder `null`. */
async function ownerOfSubject(ctx: DomainContext, subject: string): Promise<InboxOwner | null> {
  const separator = subject.indexOf(':');
  const kind = subject.slice(0, separator);
  const id = subject.slice(separator + 1);
  if (kind === 'human') return { kind: 'human', id };
  if (kind === 'agent') return { kind: 'agent', id };
  if (kind === 'user') {
    const user = (await ctx.users?.findById(id)) ?? null;
    return user === null ? null : { kind: 'human', id: user.email.toLowerCase() };
  }
  return null;
}

/**
 * Darf dieser Empfaenger die Quell-App lesen? Dieselbe Pruefung wie die
 * Forward-Auth, nur ohne Session: die Nutzer-Id (falls die Person sich je
 * angemeldet hat) und die Gruppen ihrer E-Mail, frisch gelesen.
 */
async function recipientMayRead(ctx: DomainContext, owner: InboxOwner, app: App): Promise<boolean> {
  if (owner.kind === 'agent') {
    const identity = await ctx.agents.findByName(owner.id);
    if (identity === null || identity.disabledAt !== null) return false;
    return canAccessApp(ctx, { kind: 'agent', id: owner.id }, 'read', app);
  }
  const subjects: SubjectRef[] = [];
  const user = (await ctx.users?.findByEmail(owner.id)) ?? null;
  if (user !== null) subjects.push({ kind: 'user', id: user.id });
  for (const group of await ctx.groups.groupsFor(owner.id)) {
    subjects.push({ kind: 'group', id: group });
  }
  return subjectsCanAccessApp(ctx, subjects, 'read', app);
}

/**
 * Die Empfaenger eines Ereignisses: direkt adressierte zuerst (sie gewinnen
 * gegen dieselbe Person ueber eine Gruppe), dann die Mitglieder der Gruppen
 * von jetzt. Ohne den Ausloeser, nur mit `read` auf die Quell-App.
 */
async function deriveRecipients(
  ctx: DomainContext,
  app: App,
  event: PlatformEvent,
): Promise<NotificationRecipient[]> {
  const candidates = new Map<string, NotificationRecipient>();
  const add = (owner: InboxOwner, via: 'direct' | 'group', viaGroup: string | null): void => {
    if (candidates.size >= INBOX_LIMITS.recipientsMax) return;
    const key = ownerKey(owner);
    if (!candidates.has(key)) candidates.set(key, { ...owner, via, viaGroup });
  };

  for (const subject of event.audience) {
    if (subject.startsWith('group:')) continue;
    const owner = await ownerOfSubject(ctx, subject);
    if (owner !== null) add(owner, 'direct', null);
  }
  for (const subject of event.audience) {
    if (!subject.startsWith('group:')) continue;
    const group = subject.slice('group:'.length);
    if ((await ctx.groups.findByName(group)) === null) continue;
    for (const member of await ctx.groups.listMembers(group)) {
      add({ kind: 'human', id: member.email.toLowerCase() }, 'group', group);
    }
  }

  if (event.actor !== null) {
    const actor = await ownerOfSubject(ctx, event.actor);
    if (actor !== null) candidates.delete(ownerKey(actor));
  }

  const allowed: NotificationRecipient[] = [];
  for (const recipient of candidates.values()) {
    if (await recipientMayRead(ctx, recipient, app)) allowed.push(recipient);
  }
  return allowed;
}

/* -------------------------------------------------------------------------- */
/* Eingang                                                                     */
/* -------------------------------------------------------------------------- */

export type InboxFilterState = 'open' | 'unread' | 'read' | 'done' | 'all';

const FILTER_STATES: Readonly<Record<InboxFilterState, readonly NotificationState[]>> = {
  open: ['unread', 'read'],
  unread: ['unread'],
  read: ['read'],
  done: ['done'],
  all: ['unread', 'read', 'done'],
};

export interface InboxItem {
  readonly id: string;
  readonly state: NotificationState;
  readonly app: string;
  readonly appTitle: string;
  /** Typ ohne App-Namen, `task.assigned`. */
  readonly type: string;
  readonly object: string;
  readonly title: string;
  /** Pfad in der App, wie die App ihn gemeldet hat. */
  readonly path: string;
  /** Volle Adresse zum Oeffnen, oder `null`, wenn die App keine Domain hat. */
  readonly href: string | null;
  readonly actor: string | null;
  /** Lesbarer Ausloeser: E-Mail, Name oder Agent. */
  readonly actorLabel: string | null;
  readonly importance: EventImportance;
  readonly via: 'direct' | 'group';
  readonly viaGroup: string | null;
  readonly occurredAt: string;
}

export interface InboxResult {
  readonly items: readonly InboxItem[];
  /** Ungelesen im ganzen Eingang (alle lesbaren Apps), unabhaengig vom Filter. */
  readonly unread: number;
  /** Lesbare Apps mit Eintraegen, fuer den Filter. */
  readonly apps: readonly { readonly name: string; readonly title: string }[];
}

export interface InboxCaller {
  readonly actor: Actor;
  /** Pflicht bei Menschen: der Eingang haengt an der E-Mail aus der Session. */
  readonly email?: string | null;
  readonly correlationId?: string;
}

/** Wessen Eingang ruft? Mensch ueber die E-Mail der Session, Agent ueber den Namen. */
function ownerOfCaller(caller: InboxCaller): InboxOwner {
  if (caller.actor.kind === 'agent') return { kind: 'agent', id: caller.actor.id };
  if (caller.actor.kind === 'user') {
    const email = (caller.email ?? '').trim().toLowerCase();
    if (email === '') throw new PermissionDeniedError('a person needs an email for the inbox');
    return { kind: 'human', id: email };
  }
  throw new PermissionDeniedError(`${caller.actor.kind}:${caller.actor.id} has no inbox`);
}

/**
 * Die Quell-Apps im Eingang, die der Aufrufer **jetzt** lesen darf. Die
 * zweite Pruefung aus Abschnitt C, bei jedem Aufruf, ohne Cache.
 */
async function readableInboxApps(
  ctx: DomainContext,
  caller: InboxCaller,
  owner: InboxOwner,
): Promise<App[]> {
  const names = await eventsOf(ctx).inboxApps(owner);
  const readable: App[] = [];
  for (const name of names) {
    const app = await ctx.apps.findByName(name);
    if (app === null || app.archivedAt !== null) continue;
    if (await canAccessApp(ctx, caller.actor, 'read', app)) readable.push(app);
  }
  return readable.sort((a, b) => a.name.localeCompare(b.name));
}

function parseLimit(value: unknown, fallback: number, max: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) {
    throw new ValidationError(`limit must be a whole number from 1 to ${String(max)}`);
  }
  return value;
}

async function actorLabel(ctx: DomainContext, actor: string | null): Promise<string | null> {
  if (actor === null) return null;
  const separator = actor.indexOf(':');
  const kind = actor.slice(0, separator);
  const id = actor.slice(separator + 1);
  if (kind === 'user') {
    const user = (await ctx.users?.findById(id)) ?? null;
    if (user === null) return null;
    return user.name.trim() === '' ? user.email : user.name;
  }
  return id;
}

/** `list_inbox`, `GET /api/inbox`. */
export async function listInbox(
  ctx: DomainContext,
  input: InboxCaller & {
    readonly app?: string;
    readonly state?: string;
    readonly limit?: unknown;
    /** Andere Adresse der Apps (lokaler Betrieb), wie bei der Suche. */
    readonly appHref?: (app: App) => string | null;
  },
): Promise<InboxResult> {
  return audited(
    ctx,
    {
      actor: input.actor,
      action: 'list_inbox',
      resource: null,
      detail: { app: input.app ?? null, state: input.state ?? 'open' },
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    },
    async () => {
      const owner = ownerOfCaller(input);
      const state = input.state ?? 'open';
      if (!Object.hasOwn(FILTER_STATES, state)) {
        throw new ValidationError('state must be open, unread, read, done or all');
      }
      const states = FILTER_STATES[state as InboxFilterState];
      const limit = parseLimit(input.limit, INBOX_LIMITS.default, INBOX_LIMITS.max);
      const repo = eventsOf(ctx);

      const readable = await readableInboxApps(ctx, input, owner);
      const names = readable.map((app) => app.name);
      // Ein Filter auf eine App, die der Aufrufer nicht lesen darf, ist leer,
      // nicht ein Fehler: Er erfaehrt nicht, ob es dort etwas gaebe.
      const selected =
        input.app === undefined || input.app === '' ? names : names.filter((n) => n === input.app);

      const rows =
        selected.length === 0 ? [] : await repo.listInbox({ owner, apps: selected, states, limit });
      const unread = names.length === 0 ? 0 : await repo.countInbox(owner, names, 'unread');

      const byName = new Map(readable.map((app) => [app.name, app]));
      const labels = new Map<string, string | null>();
      const items: InboxItem[] = [];
      for (const row of rows) {
        const app = byName.get(row.event.app);
        if (app === undefined) continue;
        const actor = row.event.actor;
        if (actor !== null && !labels.has(actor)) labels.set(actor, await actorLabel(ctx, actor));
        items.push(
          toItem(row, app, input.appHref, actor === null ? null : (labels.get(actor) ?? null)),
        );
      }

      return {
        value: {
          items,
          unread,
          apps: readable.map((app) => ({ name: app.name, title: app.displayName })),
        },
        detail: { returned: items.length },
      };
    },
  );
}

function toItem(
  row: InboxRow,
  app: App,
  appHref: ((app: App) => string | null) | undefined,
  label: string | null,
): InboxItem {
  const base = appHref === undefined ? gatewayAppHref(app) : appHref(app);
  return {
    id: row.id,
    state: row.state,
    app: app.name,
    appTitle: app.displayName,
    type: row.event.type,
    object: row.event.object,
    title: row.event.title,
    path: row.event.path,
    href: base === null ? null : `${base.replace(/\/+$/, '')}${row.event.path}`,
    actor: row.event.actor,
    actorLabel: label,
    importance: row.event.importance,
    via: row.via,
    viaGroup: row.viaGroup,
    occurredAt: row.event.occurredAt.toISOString(),
  };
}

/** Sortierung des Eingangs, fuer Speicher ohne SQL (In-Memory) und Tests. */
export function compareInboxRows(a: InboxRow, b: InboxRow): number {
  if (a.via !== b.via) return a.via === 'direct' ? -1 : 1;
  const importance = IMPORTANCE_ORDER[a.event.importance] - IMPORTANCE_ORDER[b.event.importance];
  if (importance !== 0) return importance;
  const time = b.event.occurredAt.getTime() - a.event.occurredAt.getTime();
  if (time !== 0) return time;
  return a.id.localeCompare(b.id);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MARK_STATES: readonly NotificationState[] = ['unread', 'read', 'done'];

/** `mark_inbox`, `POST /api/inbox/mark`: nur eigene Zeilen aus lesbaren Apps. */
export async function markInbox(
  ctx: DomainContext,
  input: InboxCaller & { readonly ids: unknown; readonly state: unknown },
): Promise<{ readonly updated: number }> {
  return audited(
    ctx,
    {
      actor: input.actor,
      action: 'mark_inbox',
      resource: null,
      detail: { state: typeof input.state === 'string' ? input.state : null },
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    },
    async () => {
      const owner = ownerOfCaller(input);
      if (
        typeof input.state !== 'string' ||
        !MARK_STATES.includes(input.state as NotificationState)
      ) {
        throw new ValidationError('state must be unread, read or done');
      }
      const ids = input.ids;
      if (
        !Array.isArray(ids) ||
        ids.length === 0 ||
        ids.length > INBOX_LIMITS.markMax ||
        !ids.every((id) => typeof id === 'string' && UUID.test(id))
      ) {
        throw new ValidationError(
          `ids must be a list of 1 to ${String(INBOX_LIMITS.markMax)} ids from list_inbox`,
        );
      }
      const readable = (await readableInboxApps(ctx, input, owner)).map((app) => app.name);
      const updated =
        readable.length === 0
          ? 0
          : await eventsOf(ctx).markInbox(
              owner,
              [...new Set(ids as string[])],
              readable,
              input.state as NotificationState,
              ctx.clock.now(),
            );
      return { value: { updated }, detail: { requested: ids.length, updated } };
    },
  );
}

/* -------------------------------------------------------------------------- */
/* Abonnements                                                                 */
/* -------------------------------------------------------------------------- */

/** Ein Ereignis, wie ein Abonnent es sieht: ohne `audience`. */
export interface PolledEvent {
  readonly seq: number;
  readonly id: string;
  readonly app: string;
  readonly type: string;
  readonly object: string;
  readonly title: string;
  readonly path: string;
  readonly actor: string | null;
  readonly occurredAt: string;
}

/** Die Abonnements der App, deren Quell-App sie **jetzt** lesen darf. */
async function readableSubscriptions(
  ctx: DomainContext,
  actor: Actor,
  app: App,
): Promise<EventSubscriptionRef[]> {
  const result: EventSubscriptionRef[] = [];
  const decided = new Map<string, boolean>();
  for (const subscription of app.manifest.subscriptions ?? []) {
    let allowed = decided.get(subscription.app);
    if (allowed === undefined) {
      const source = await ctx.apps.findByName(subscription.app);
      allowed =
        source !== null &&
        source.archivedAt === null &&
        (await canAccessApp(ctx, actor, 'read', source));
      decided.set(subscription.app, allowed);
    }
    if (allowed) result.push({ app: subscription.app, type: subscription.type });
  }
  return result;
}

/** `poll_events`: Ereignisse der eigenen Abonnements ab dem Cursor. */
export async function pollEvents(
  ctx: DomainContext,
  input: { readonly actor: Actor; readonly limit?: unknown; readonly correlationId?: string },
): Promise<{ readonly events: readonly PolledEvent[] }> {
  return audited(
    ctx,
    {
      actor: input.actor,
      action: 'poll_events',
      resource: { kind: 'tool', id: `${PLATFORM_TARGET}.poll_events` },
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    },
    async () => {
      await requirePermission(ctx, input.actor, 'execute', {
        kind: 'tool',
        id: `${PLATFORM_TARGET}.poll_events`,
      });
      const app = await callerApp(ctx, input.actor);
      const limit = parseLimit(input.limit, POLL_LIMITS.default, POLL_LIMITS.max);
      const subscriptions = await readableSubscriptions(ctx, input.actor, app);
      const events =
        subscriptions.length === 0
          ? []
          : await eventsOf(ctx).pollEvents({ subscriber: app.name, subscriptions, limit });
      return {
        value: { events: events.map(toPolled) },
        detail: { subscriptions: subscriptions.length, returned: events.length },
      };
    },
  );
}

function toPolled(event: StoredEvent): PolledEvent {
  return {
    seq: event.seq,
    id: event.eventId,
    app: event.app,
    type: event.type,
    object: event.object,
    title: event.title,
    path: event.path,
    actor: event.actor,
    occurredAt: event.occurredAt.toISOString(),
  };
}

/**
 * `ack_events`: Cursor der lesbaren Abonnements auf mindestens `upTo`. Was
 * die App gerade nicht lesen darf, bleibt stehen und kommt nach einer neuen
 * Freigabe ab dem alten Cursor.
 */
export async function ackEvents(
  ctx: DomainContext,
  input: { readonly actor: Actor; readonly upTo: unknown; readonly correlationId?: string },
): Promise<{ readonly acknowledged: number }> {
  return audited(
    ctx,
    {
      actor: input.actor,
      action: 'ack_events',
      resource: { kind: 'tool', id: `${PLATFORM_TARGET}.ack_events` },
      detail: { upTo: typeof input.upTo === 'number' ? input.upTo : null },
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    },
    async () => {
      await requirePermission(ctx, input.actor, 'execute', {
        kind: 'tool',
        id: `${PLATFORM_TARGET}.ack_events`,
      });
      const app = await callerApp(ctx, input.actor);
      const repo = eventsOf(ctx);
      const upTo = input.upTo;
      if (typeof upTo !== 'number' || !Number.isSafeInteger(upTo) || upTo < 0) {
        throw new ValidationError('upTo must be the seq of the last handled event');
      }
      // Weiter als bis zum letzten Ereignis hiesse: kuenftige ueberspringen.
      if (upTo > (await repo.maxSeq())) {
        throw new ValidationError('upTo is beyond the last event');
      }
      const subscriptions = await readableSubscriptions(ctx, input.actor, app);
      const acknowledged =
        subscriptions.length === 0
          ? 0
          : await repo.ackEvents({
              subscriber: app.name,
              subscriptions,
              upTo,
              at: ctx.clock.now(),
            });
      return { value: { acknowledged }, detail: { acknowledged } };
    },
  );
}

/* -------------------------------------------------------------------------- */
/* Plattform-Tools fuer Apps                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Ein Aufruf einer App an `platform.<tool>` (ADR 0022 A). Der Aufrufer ist
 * schon als App geprueft (`verifyAppCaller`); die Freigabe prueft jedes Tool
 * selbst. Ein Tool, das es nicht gibt, ist 404.
 */
export async function callPlatformTool(
  ctx: DomainContext,
  input: {
    readonly actor: Actor;
    readonly tool: string;
    readonly args: Readonly<Record<string, unknown>>;
    readonly correlationId?: string;
  },
): Promise<unknown> {
  const extra = input.correlationId === undefined ? {} : { correlationId: input.correlationId };
  switch (input.tool) {
    case 'emit_event':
      return emitEvent(ctx, { actor: input.actor, args: input.args, ...extra });
    case 'poll_events':
      return pollEvents(ctx, { actor: input.actor, limit: input.args.limit, ...extra });
    case 'ack_events':
      return ackEvents(ctx, { actor: input.actor, upTo: input.args.upTo, ...extra });
    case 'set_refs':
      return setRefs(ctx, { actor: input.actor, args: input.args, ...extra });
    case 'generate':
      return generateForApp(ctx, { actor: input.actor, args: input.args, ...extra });
    case 'embed':
      return embedForApp(ctx, { actor: input.actor, args: input.args, ...extra });
    case 'model_info':
      // ADR 0025: kein eigenes Recht, sondern `embed` oder `generate`.
      return modelInfoForApp(ctx, { actor: input.actor, ...extra });
    default:
      throw new NotFoundError(`the platform offers no tool "${input.tool}" to apps`);
  }
}

/* -------------------------------------------------------------------------- */
/* Aufbewahrung                                                                */
/* -------------------------------------------------------------------------- */

/** Liest `OPENAPPS_EVENTS_RETENTION_DAYS`: ganze Tage ab 1, sonst der Default. */
export function retentionDaysFrom(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return EVENTS_RETENTION_DAYS_DEFAULT;
  const days = Number(value.trim());
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    throw new Error(
      `OPENAPPS_EVENTS_RETENTION_DAYS="${value}": expected whole days from 1 to 3650`,
    );
  }
  return days;
}

/**
 * Loescht Ereignisse (und ihre Benachrichtigungen), die laenger als die
 * Frist bei der Plattform liegen (ADR 0022 F). Gemessen an der Uhr der
 * Plattform (`received_at`), nicht an der Zeit, die die App angibt.
 */
export async function purgeExpiredEvents(
  ctx: DomainContext,
  input: { readonly retentionDays: number },
): Promise<{ readonly events: number; readonly notifications: number; readonly cutoff: Date }> {
  if (!Number.isInteger(input.retentionDays) || input.retentionDays < 1) {
    throw new ValidationError('retentionDays must be a whole number of at least 1');
  }
  const cutoff = new Date(ctx.clock.now().getTime() - input.retentionDays * 86_400_000);
  const removed = await eventsOf(ctx).purgeReceivedBefore(cutoff);
  return { ...removed, cutoff };
}
