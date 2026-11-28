import { callAppTool } from './app-call.js';
import { SdkError } from './errors.js';
import { createOutbox, type Outbox, type OutboxLogger, type OutboxQuery } from './outbox.js';
import { isAppRelativePath } from './search.js';

/**
 * Ereignisse einer App an die Plattform (ADR 0022).
 *
 * Eine App meldet, was in ihr passiert ist (`task.assigned`, `deal.won`), an
 * wen es gehen soll (`audience`) und wohin der Link fuehrt (`path`). Die
 * Plattform nimmt nur Typen an, die das Manifest unter `events` erklaert, und
 * nur mit der Freigabe `execute` auf `platform.emit_event`. Wer davon eine
 * Benachrichtigung bekommt, entscheidet die Plattform: nur, wer die App lesen
 * darf. Die App prueft das nicht und erfaehrt nicht, wer herausfiel.
 *
 * Inhalt geht nicht mit, nur der Titel. Der Inhalt bleibt in der App; Home
 * verlinkt dorthin.
 *
 * ```ts
 * const events = createEventOutbox({ query });
 * await withTransaction(async (q) => {
 *   await q('update tasks set assignee = $2 where id = $1', [id, email]);
 *   await events.emit(q, {
 *     id: `task.assigned:${id}:${revision}`,
 *     type: 'task.assigned',
 *     object: `task:${id}`,
 *     title: `Assigned to you: ${title}`,
 *     path: `/task/${id}`,
 *     actor: recipientOf(actorEmail),
 *     audience: [recipientOf(email)],
 *   });
 * });
 * events.kick();
 * ```
 */

/** Grenzen eines Ereignisses. Dieselben prueft die Plattform beim Annehmen. */
export const EVENT_LIMITS = Object.freeze({
  id: 200,
  object: 300,
  title: 200,
  path: 1000,
  /** Hoechstens so viele Empfaenger-Angaben je Ereignis. */
  audience: 50,
  subject: 320,
});

/** Default-Tabelle der Ereignis-Outbox im Schema der App. */
export const EVENT_OUTBOX_TABLE = 'event_outbox';

/** Ein Ereignis, wie die App es meldet. */
export interface PlatformEventInput {
  /** Von der App vergeben, eindeutig je App; schuetzt vor Doppeln. */
  readonly id: string;
  /** Wie im Manifest unter `events`, ohne App-Namen: `task.assigned`. */
  readonly type: string;
  /** Worum es geht, ein Schluessel der App: `task:<id>`. */
  readonly object: string;
  /** Klartext, kurz. Kein Inhalt. */
  readonly title: string;
  /** Pfad in der App, ohne basePath: `/task/<id>`. */
  readonly path: string;
  /** Wer es ausgeloest hat (`human:`, `user:`, `agent:`, `app:`). Nur Anzeige. */
  readonly actor?: string | null;
  /**
   * An wen: `human:<email>`, `user:<id>` (Nutzer-Id aus `getUser`),
   * `group:<name>`, `agent:<name>`. Leer heisst: niemand bekommt eine
   * Benachrichtigung, Abonnenten sehen das Ereignis trotzdem.
   */
  readonly audience?: readonly (string | null | undefined)[];
  /** Wann es passiert ist. Default: jetzt. */
  readonly occurredAt?: string | Date;
}

/** Ein Ereignis in der Form, die an `platform.emit_event` geht. */
export interface PlatformEvent {
  readonly id: string;
  readonly type: string;
  readonly object: string;
  readonly title: string;
  readonly path: string;
  readonly actor: string | null;
  readonly audience: readonly string[];
  readonly occurredAt: string;
}

/** Ein Ereignis passt nicht in die feste Form. Wirft vor jedem Schreiben. 400. */
export class EventInputError extends SdkError {
  constructor(message: string) {
    super(message, 400);
  }
}

const EVENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const EVENT_TYPE = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const EMAIL = /^[^@\s,:;<>"]+@[^@\s,:;<>"]+$/;
const USER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const GROUP_NAME = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;
const AGENT_NAME = /^[a-z][a-z0-9-]{1,62}$/;
const APP_NAME = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;

/**
 * Prueft eine Empfaenger- oder Ausloeser-Angabe und bringt sie in die feste
 * Form (E-Mail klein). `null`, wenn sie keine der erlaubten Formen hat.
 * `app:` nur mit `allowApp` (Ausloeser, nie Empfaenger).
 */
export function normalizeSubject(value: string, allowApp = false): string | null {
  if (value.length > EVENT_LIMITS.subject) return null;
  const separator = value.indexOf(':');
  if (separator === -1) return null;
  const kind = value.slice(0, separator);
  const id = value.slice(separator + 1);
  switch (kind) {
    case 'human': {
      const email = id.trim().toLowerCase();
      return EMAIL.test(email) ? `human:${email}` : null;
    }
    case 'user':
      return USER_ID.test(id) ? `user:${id}` : null;
    case 'group':
      return GROUP_NAME.test(id) ? `group:${id}` : null;
    case 'agent':
      return AGENT_NAME.test(id) ? `agent:${id}` : null;
    case 'app':
      return allowApp && APP_NAME.test(id) ? `app:${id}` : null;
    default:
      return null;
  }
}

/**
 * Aus dem, was eine App ueber eine Person speichert, die Empfaenger-Angabe:
 *
 * - `agent:<name>` und `<name>@agents.invalid` → `agent:<name>`
 * - `app:<name>` und `<name>@apps.invalid` → `null` (Apps haben keinen Eingang)
 * - eine E-Mail → `human:<email>`
 * - sonst, wie `getUser().id` → `user:<id>`
 *
 * `null` fuer leere oder unbrauchbare Werte. Wirft nie.
 */
export function recipientOf(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.startsWith('agent:')) return normalizeSubject(trimmed);
  if (trimmed.startsWith('app:')) return null;
  const lower = trimmed.toLowerCase();
  if (lower.endsWith('@agents.invalid')) {
    return normalizeSubject(`agent:${lower.slice(0, -'@agents.invalid'.length)}`);
  }
  if (lower.endsWith('@apps.invalid')) return null;
  if (trimmed.includes('@')) return normalizeSubject(`human:${lower}`);
  return normalizeSubject(`user:${trimmed}`);
}

/** Wie `recipientOf`, aber eine App bleibt als Ausloeser erhalten. */
export function actorOf(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.startsWith('app:')) return normalizeSubject(trimmed, true);
  if (trimmed.toLowerCase().endsWith('@apps.invalid')) {
    return normalizeSubject(`app:${trimmed.toLowerCase().slice(0, -'@apps.invalid'.length)}`, true);
  }
  return recipientOf(trimmed);
}

/** Ein Titel in einer Zeile, gekuerzt. Leer bleibt leer (und ist ein Fehler). */
export function eventTitle(text: string): string {
  const flat = text.replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim();
  return flat.length > EVENT_LIMITS.title ? `${flat.slice(0, EVENT_LIMITS.title - 1)}…` : flat;
}

/**
 * Prueft ein Ereignis und gibt es in fester Form zurueck. Dieselbe Pruefung
 * macht die Plattform beim Annehmen, mit `now` als ihrer Uhr. Doppelte
 * Empfaenger fallen weg, `null` in `audience` auch.
 */
export function parsePlatformEvent(input: unknown, now: Date = new Date()): PlatformEvent {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new EventInputError('an event must be an object');
  }
  const record = input as Record<string, unknown>;
  const allowed = new Set([
    'id',
    'type',
    'object',
    'title',
    'path',
    'actor',
    'audience',
    'occurredAt',
  ]);
  const unknownKeys = Object.keys(record).filter((key) => !allowed.has(key));
  if (unknownKeys.length > 0) {
    throw new EventInputError(`unknown field: ${unknownKeys.join(', ')}`);
  }

  const id = record.id;
  if (typeof id !== 'string' || !EVENT_ID.test(id)) {
    throw new EventInputError('id must be 1 to 200 characters of [A-Za-z0-9._:-]');
  }
  const type = record.type;
  if (typeof type !== 'string' || type.length > 64 || !EVENT_TYPE.test(type)) {
    throw new EventInputError('type must be <object>.<action> of [a-z0-9_], e.g. task.assigned');
  }
  const object = record.object;
  if (
    typeof object !== 'string' ||
    object.trim() === '' ||
    object.length > EVENT_LIMITS.object ||
    CONTROL.test(object)
  ) {
    throw new EventInputError('object must be 1 to 300 characters without control characters');
  }
  if (typeof record.title !== 'string') throw new EventInputError('title must be a string');
  const title = eventTitle(record.title);
  if (title === '') throw new EventInputError('title must not be empty');
  const path = record.path;
  if (typeof path !== 'string' || !isAppRelativePath(path)) {
    throw new EventInputError('path must be a path in the app without its base path, e.g. /task/1');
  }

  let actor: string | null = null;
  if (record.actor !== undefined && record.actor !== null) {
    if (typeof record.actor !== 'string') throw new EventInputError('actor must be a string');
    actor = normalizeSubject(record.actor, true);
    if (actor === null) {
      throw new EventInputError(
        'actor must be human:<email>, user:<id>, agent:<name> or app:<name>',
      );
    }
  }

  const audience: string[] = [];
  if (record.audience !== undefined && record.audience !== null) {
    if (!Array.isArray(record.audience)) throw new EventInputError('audience must be a list');
    for (const entry of record.audience as unknown[]) {
      if (entry === null || entry === undefined) continue;
      const subject = typeof entry === 'string' ? normalizeSubject(entry) : null;
      if (subject === null) {
        throw new EventInputError(
          'audience entries must be human:<email>, user:<id>, group:<name> or agent:<name>',
        );
      }
      if (!audience.includes(subject)) audience.push(subject);
    }
    if (audience.length > EVENT_LIMITS.audience) {
      throw new EventInputError(`audience has more than ${String(EVENT_LIMITS.audience)} entries`);
    }
  }

  let occurredAt: Date;
  if (record.occurredAt === undefined || record.occurredAt === null) {
    occurredAt = now;
  } else if (record.occurredAt instanceof Date) {
    occurredAt = record.occurredAt;
  } else if (typeof record.occurredAt === 'string' && record.occurredAt.length <= 40) {
    occurredAt = new Date(record.occurredAt);
  } else {
    throw new EventInputError('occurredAt must be an ISO timestamp');
  }
  if (Number.isNaN(occurredAt.getTime())) {
    throw new EventInputError('occurredAt must be an ISO timestamp');
  }
  // Etwas Vorlauf fuer eine Uhr, die vorgeht; mehr ist ein Fehler der App.
  if (occurredAt.getTime() > now.getTime() + 5 * 60_000) {
    throw new EventInputError('occurredAt lies in the future');
  }

  return { id, type, object, title, path, actor, audience, occurredAt: occurredAt.toISOString() };
}

/* -------------------------------------------------------------------------- */
/* Outbox fuer Ereignisse                                                      */
/* -------------------------------------------------------------------------- */

export interface EventOutboxOptions {
  /** Abfragen ausserhalb einer Transaktion (Pool). */
  readonly query: OutboxQuery;
  /** Default `event_outbox`. */
  readonly table?: string;
  /** Praefix im Log. Default `[events]`. */
  readonly name?: string;
  /** Fuer Tests: der Weg zur Plattform. Default `callAppTool('platform', 'emit_event', …)`. */
  readonly send?: (event: PlatformEvent) => Promise<unknown>;
  readonly retryIntervalMs?: number;
  readonly logger?: OutboxLogger;
}

export interface EventOutbox extends Omit<Outbox, 'enqueue' | 'requeueClause'> {
  /**
   * Prueft das Ereignis und reiht es ein. **Nur in der Transaktion der
   * Aenderung** aufrufen. Wirft `EventInputError`, bevor etwas geschrieben
   * wird; dann rollt die Transaktion der App zurueck, und das ist richtig:
   * Ein falsch gebautes Ereignis ist ein Fehler im Code, kein Netzproblem.
   */
  emit(q: OutboxQuery, event: PlatformEventInput | readonly PlatformEventInput[]): Promise<void>;
}

/** Der Normalweg: ueber die Plattform, signiert mit dem Call-Secret der App. */
export function sendToPlatform(event: PlatformEvent): Promise<unknown> {
  return callAppTool('platform', 'emit_event', { ...event, audience: [...event.audience] });
}

export function createEventOutbox(options: EventOutboxOptions): EventOutbox {
  const send = options.send ?? sendToPlatform;
  const outbox = createOutbox({
    name: options.name ?? '[events]',
    table: options.table ?? EVENT_OUTBOX_TABLE,
    query: options.query,
    ...(options.retryIntervalMs === undefined ? {} : { retryIntervalMs: options.retryIntervalMs }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    async deliver(entry) {
      // Noch einmal geprueft: Die Zeile kann von Hand oder aus einer aelteren
      // Fassung stammen. Was nicht passt, geht nicht raus und bleibt sichtbar.
      await send(parsePlatformEvent(entry.payload));
    },
  });
  const { enqueue: _enqueue, requeueClause: _clause, ...rest } = outbox;
  return {
    ...rest,
    async emit(q, event) {
      const list = (Array.isArray(event) ? event : [event]) as readonly PlatformEventInput[];
      const parsed = list.map((entry) => parsePlatformEvent(entry));
      await outbox.enqueue(
        q,
        parsed.map((entry) => ({ key: entry.id, payload: entry })),
        { onConflict: 'ignore' },
      );
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Abonnements (ADR 0022 E)                                                    */
/* -------------------------------------------------------------------------- */

/** Ein Ereignis einer anderen App, wie `poll_events` es liefert. */
export interface ReceivedEvent {
  /** Fortlaufende Nummer der Plattform. Bis hierher wird quittiert. */
  readonly seq: number;
  /** Die Id der Quell-App: Schluessel fuer einen idempotenten Handler. */
  readonly id: string;
  readonly app: string;
  readonly type: string;
  readonly object: string;
  readonly title: string;
  readonly path: string;
  readonly actor: string | null;
  readonly occurredAt: string;
}

export interface SubscribeOptions {
  /** Abstand der Abrufe. Default 30 000 ms. */
  readonly intervalMs?: number;
  /** Ereignisse je Abruf, 1 bis 200. Default 100. */
  readonly limit?: number;
  /** Fuer Tests. Default `callAppTool('platform', 'poll_events', { limit })`. */
  readonly poll?: (limit: number) => Promise<unknown>;
  /** Fuer Tests. Default `callAppTool('platform', 'ack_events', { upTo })`. */
  readonly ack?: (upTo: number) => Promise<unknown>;
  readonly logger?: OutboxLogger;
}

export interface PollReport {
  handled: number;
  skipped: number;
  /** Ein Handler oder die Plattform ist gescheitert; der Rest kommt beim naechsten Abruf. */
  stopped: boolean;
  lastError: string | null;
}

export interface Subscription {
  /** Ruft jetzt ab und danach im Takt. */
  start(): void;
  stop(): void;
  /** Ein Abruf bis zur leeren Antwort oder zum ersten Fehler. */
  pollOnce(): Promise<PollReport>;
}

function parseReceived(value: unknown): ReceivedEvent[] {
  if (typeof value !== 'object' || value === null) return [];
  const events = (value as Record<string, unknown>).events;
  if (!Array.isArray(events)) return [];
  const result: ReceivedEvent[] = [];
  for (const entry of events as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    if (
      typeof e.seq !== 'number' ||
      typeof e.id !== 'string' ||
      typeof e.app !== 'string' ||
      typeof e.type !== 'string'
    ) {
      continue;
    }
    result.push({
      seq: e.seq,
      id: e.id,
      app: e.app,
      type: e.type,
      object: typeof e.object === 'string' ? e.object : '',
      title: typeof e.title === 'string' ? e.title : '',
      path: typeof e.path === 'string' ? e.path : '/',
      actor: typeof e.actor === 'string' ? e.actor : null,
      occurredAt: typeof e.occurredAt === 'string' ? e.occurredAt : '',
    });
  }
  return result.sort((a, b) => a.seq - b.seq);
}

/**
 * Ruft Ereignisse anderer Apps ab, die das Manifest unter `subscriptions`
 * nennt, und gibt die mit einem Typ aus `types` (`<app>.<type>`, etwa
 * `mail.message.received`) an `handler`. Danach quittiert es bis zum letzten
 * Ereignis, das geklappt hat.
 *
 * Zustellung **mindestens einmal**: Scheitert der Handler oder die
 * Quittung, kommt das Ereignis wieder. Der Handler muss mit `event.id`
 * idempotent sein. Ein `subscribe` je App: Die Quittung gilt fuer alle
 * Abonnements der App.
 *
 * Ob die App die Ereignisse sehen darf, entscheidet die Plattform bei jedem
 * Abruf (`read` auf die Quell-App). Ohne Freigabe kommt nichts.
 */
export function subscribe(
  types: readonly string[],
  handler: (event: ReceivedEvent) => Promise<void>,
  options: SubscribeOptions = {},
): Subscription {
  const wanted = new Set(types);
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 100), 1), 200);
  const intervalMs = options.intervalMs ?? 30_000;
  const logger = options.logger ?? console;
  const poll =
    options.poll ?? ((max: number) => callAppTool('platform', 'poll_events', { limit: max }));
  const ack = options.ack ?? ((upTo: number) => callAppTool('platform', 'ack_events', { upTo }));

  let running: Promise<PollReport> | null = null;

  async function once(): Promise<PollReport> {
    const report: PollReport = { handled: 0, skipped: 0, stopped: false, lastError: null };
    for (;;) {
      let batch: ReceivedEvent[];
      try {
        batch = parseReceived(await poll(limit));
      } catch (error) {
        report.stopped = true;
        report.lastError = error instanceof Error ? error.message.slice(0, 500) : 'poll failed';
        return report;
      }
      if (batch.length === 0) return report;

      let lastOk: number | null = null;
      for (const event of batch) {
        if (!wanted.has(`${event.app}.${event.type}`)) {
          report.skipped += 1;
          lastOk = event.seq;
          continue;
        }
        try {
          await handler(event);
          report.handled += 1;
          lastOk = event.seq;
        } catch (error) {
          report.stopped = true;
          report.lastError = error instanceof Error ? `handler: ${error.name}` : 'handler failed';
          break;
        }
      }
      if (lastOk !== null) {
        try {
          await ack(lastOk);
        } catch (error) {
          report.stopped = true;
          report.lastError = error instanceof Error ? error.message.slice(0, 500) : 'ack failed';
          return report;
        }
      }
      if (report.stopped || batch.length < limit) return report;
    }
  }

  async function pollOnce(): Promise<PollReport> {
    if (running !== null) return running;
    running = once().finally(() => {
      running = null;
    });
    const report = await running;
    if (report.lastError !== null) logger.warn(`[events] subscription: ${report.lastError}`);
    return report;
  }

  let timer: ReturnType<typeof setInterval> | null = null;
  return {
    start() {
      void pollOnce();
      if (timer !== null) return;
      timer = setInterval(() => void pollOnce(), intervalMs);
      timer.unref?.();
    },
    stop() {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
    pollOnce,
  };
}
