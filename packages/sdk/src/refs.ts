import {
  extractRefs,
  parseObjectRef,
  parseRef,
  type ObjectRef,
  type ParsedRef,
} from '@openapps/app-manifest/refs';
import { callAppTool } from './app-call.js';
import { SdkError } from './errors.js';
import { createOutbox, type Outbox, type OutboxLogger, type OutboxQuery } from './outbox.js';
import { isAppRelativePath } from './search.js';
import { ToolInputError } from './tools.js';
import { normalizeSubject } from './events.js';

export {
  extractRefs,
  formatObjectRef,
  formatRefToken,
  formatSubjectRef,
  isRefAppName,
  isRefId,
  isRefType,
  parseObjectRef,
  parseRef,
  parseSubjectRef,
  REF_LIMITS,
  RefFormatError,
  RESERVED_APP_NAMES,
  splitRefTokens,
  type ObjectRef,
  type ParsedRef,
  type RefSegment,
  type RefSubjectKind,
  type SubjectRef,
} from '@openapps/app-manifest/refs';

/**
 * Verweise zwischen Apps (ADR 0023), die Seite der App.
 *
 * ## Aufloesen: der Resolver einer App
 *
 * Eine App erklaert im Manifest unter `objects` ihre Objektarten und je Art
 * ein `read`-Tool als Resolver. Die Plattform ruft es mit `{ type, ids }` und
 * erwartet `{ objects: [{ id, title, path, status?, updatedAt }] }`. Fehlende
 * Ids fehlen in der Antwort. Die App prueft keine Rechte; das hat die
 * Plattform vorher getan (`read` des Betrachters auf die App).
 *
 * ## Melden: die vollstaendige Menge ausgehender Verweise
 *
 * Bei jeder Aenderung eines Objekts meldet die App die **ganze** Menge seiner
 * ausgehenden Verweise an `platform.set_refs`, ueber eine Outbox in derselben
 * Transaktion (`createRefsOutbox`). Leere Menge loescht, ein aelterer Stand
 * wird ignoriert. Kommt eine Person, Gruppe oder ein Agent neu hinzu, legt
 * die Plattform eine Erwaehnung im Eingang an, nur fuer Subjekte, die die
 * App lesen duerfen.
 */

export const REFS_LIMITS = Object.freeze({
  /** Hoechstens so viele Ziele je Quelle. */
  targets: 200,
  /** Hoechstens so viele Ids je Aufruf eines Resolvers. */
  resolveIds: 50,
  title: 200,
  status: 40,
});

/** Default-Tabelle der Verweis-Outbox im Schema der App. */
export const REFS_OUTBOX_TABLE = 'refs_outbox';

/** Art eines Verweises: Erwaehnung (Subjekt), Link (Objekt) oder abgeleitet („aus X wird Y“). */
export type RefKind = 'mention' | 'link' | 'derived';

const KINDS: readonly RefKind[] = ['mention', 'link', 'derived'];

/** Ein Ziel, wie die App es meldet: der Verweis allein oder mit Art. */
export type RefTargetInput = string | { readonly ref: string; readonly kind?: RefKind };

export interface SetRefsInput {
  /** Das eigene Objekt: `<app>:<typ>:<id>`, `app` ist die meldende App. */
  readonly source: string;
  /** Die vollstaendige Menge; leer loescht. */
  readonly targets: readonly RefTargetInput[];
  /** Stand des Objekts. Ein aelterer Stand als der gespeicherte wird ignoriert. */
  readonly updatedAt: string | Date;
  /** Titel der Quelle, nur fuer die Erwaehnung im Eingang. Kein Inhalt. */
  readonly title?: string | null;
  /** Pfad der Quelle in der App, fuer den Link der Erwaehnung. */
  readonly path?: string | null;
  /** Wer geaendert hat (wie `actorOf`); bekommt keine Erwaehnung von sich selbst. */
  readonly actor?: string | null;
}

export interface SetRefsTarget {
  readonly ref: string;
  readonly kind: RefKind;
}

/** Die gepruefte Form, wie sie an `platform.set_refs` geht. */
export interface SetRefsPayload {
  readonly source: string;
  readonly targets: readonly SetRefsTarget[];
  readonly updatedAt: string;
  readonly title: string | null;
  readonly path: string | null;
  readonly actor: string | null;
}

/** Eine Meldung passt nicht in die feste Form. Wirft vor jedem Schreiben. 400. */
export class RefsInputError extends SdkError {
  constructor(message: string) {
    super(message, 400);
  }
}

const CONTROL = /[\u0000-\u001f\u007f]/;

function oneLine(value: string, max: number): string {
  const flat = value.replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Die Art eines Ziels: Subjekte sind Erwaehnungen, Objekte Links, wenn nichts anderes gesagt ist. */
function kindFor(parsed: ParsedRef, kind: unknown): RefKind {
  if (kind !== undefined && (typeof kind !== 'string' || !KINDS.includes(kind as RefKind))) {
    throw new RefsInputError('kind must be mention, link or derived');
  }
  if (parsed.kind === 'subject') {
    if (kind !== undefined && kind !== 'mention') {
      throw new RefsInputError(`${parsed.ref} is a person, group or agent: only kind mention`);
    }
    return 'mention';
  }
  if (kind === 'mention') {
    throw new RefsInputError(`${parsed.ref} is an object: kind link or derived, not mention`);
  }
  return (kind as RefKind | undefined) ?? 'link';
}

/**
 * Prueft eine Meldung und bringt sie in die feste Form. Dieselbe Pruefung
 * macht die Plattform beim Annehmen, mit `now` als ihrer Uhr. Ein Ziel, das
 * die Quelle selbst ist, faellt weg; doppelte Ziele werden eins, `derived`
 * gewinnt gegen `link`.
 */
export function parseSetRefs(input: unknown, now: Date = new Date()): SetRefsPayload {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new RefsInputError('set_refs needs an object with source, targets and updatedAt');
  }
  const record = input as Record<string, unknown>;
  const allowed = new Set(['source', 'targets', 'updatedAt', 'title', 'path', 'actor']);
  const unknownKeys = Object.keys(record).filter((key) => !allowed.has(key));
  if (unknownKeys.length > 0) {
    throw new RefsInputError(`unknown field: ${unknownKeys.join(', ')}`);
  }

  const source = parseObjectRef(record.source);
  if (source === null) {
    throw new RefsInputError('source must be an object reference <app>:<type>:<id>');
  }

  if (!Array.isArray(record.targets)) throw new RefsInputError('targets must be a list');
  if (record.targets.length > REFS_LIMITS.targets) {
    throw new RefsInputError(`targets has more than ${String(REFS_LIMITS.targets)} entries`);
  }
  const byRef = new Map<string, RefKind>();
  for (const entry of record.targets as unknown[]) {
    const raw =
      typeof entry === 'string'
        ? { ref: entry, kind: undefined }
        : typeof entry === 'object' && entry !== null && !Array.isArray(entry)
          ? (entry as Record<string, unknown>)
          : null;
    if (raw === null) throw new RefsInputError('a target must be a reference or { ref, kind }');
    if (
      typeof entry === 'object' &&
      Object.keys(raw).some((key) => key !== 'ref' && key !== 'kind')
    ) {
      throw new RefsInputError('a target has only ref and kind');
    }
    const parsed = parseRef(raw.ref);
    if (parsed === null) {
      throw new RefsInputError(
        'targets must be references: <app>:<type>:<id>, human:<email>, group:<name> or agent:<name>',
      );
    }
    if (parsed.ref === source.ref) continue;
    const kind = kindFor(parsed, raw.kind);
    const previous = byRef.get(parsed.ref);
    byRef.set(parsed.ref, previous === 'derived' ? 'derived' : kind);
  }

  let updatedAt: Date;
  if (record.updatedAt instanceof Date) updatedAt = record.updatedAt;
  else if (typeof record.updatedAt === 'string' && record.updatedAt.length <= 40) {
    updatedAt = new Date(record.updatedAt);
  } else throw new RefsInputError('updatedAt must be an ISO timestamp');
  if (Number.isNaN(updatedAt.getTime()))
    throw new RefsInputError('updatedAt must be an ISO timestamp');
  if (updatedAt.getTime() > now.getTime() + 5 * 60_000) {
    throw new RefsInputError('updatedAt lies in the future');
  }

  let title: string | null = null;
  if (record.title !== undefined && record.title !== null) {
    if (typeof record.title !== 'string') throw new RefsInputError('title must be a string');
    title = oneLine(record.title, REFS_LIMITS.title);
    if (title === '') title = null;
  }
  let path: string | null = null;
  if (record.path !== undefined && record.path !== null) {
    if (typeof record.path !== 'string' || !isAppRelativePath(record.path)) {
      throw new RefsInputError(
        'path must be a path in the app without its base path, e.g. /task/1',
      );
    }
    path = record.path;
  }
  let actor: string | null = null;
  if (record.actor !== undefined && record.actor !== null) {
    actor = typeof record.actor === 'string' ? normalizeSubject(record.actor, true) : null;
    if (actor === null) {
      throw new RefsInputError(
        'actor must be human:<email>, user:<id>, agent:<name> or app:<name>',
      );
    }
  }

  return {
    source: source.ref,
    targets: [...byRef.entries()].map(([ref, kind]) => ({ ref, kind })),
    updatedAt: updatedAt.toISOString(),
    title,
    path,
    actor,
  };
}

/**
 * Die Ziele aus einem oder mehreren Texten (`@{…}`), fuer `targets`. Doppel
 * fallen weg; hoechstens `REFS_LIMITS.targets`.
 */
export function refTargetsFromText(...texts: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  for (const text of texts) {
    if (typeof text !== 'string' || text === '') continue;
    for (const ref of extractRefs(text, REFS_LIMITS.targets)) {
      if (seen.size >= REFS_LIMITS.targets) break;
      seen.add(ref.ref);
    }
  }
  return [...seen];
}

/* -------------------------------------------------------------------------- */
/* Resolver                                                                    */
/* -------------------------------------------------------------------------- */

export interface ResolveToolArgs {
  /** Die Objektart aus dem Manifest, `task`. */
  readonly type: string;
  /** Hoechstens `REFS_LIMITS.resolveIds`, ohne Doppel. */
  readonly ids: readonly string[];
}

export interface ResolvedObject {
  readonly id: string;
  readonly title: string;
  /** Pfad in der App ohne basePath, beginnt mit `/`. */
  readonly path: string;
  /** Kurzer Status fuer den Chip, etwa `Done`. Kein Inhalt. */
  readonly status?: string;
  readonly updatedAt: string;
}

export interface ResolveToolResult {
  readonly objects: readonly ResolvedObject[];
}

/**
 * Prueft die Argumente eines Resolvers: `type` (Slug) und `ids` (1 bis 50,
 * ohne Doppel). Wirft `ToolInputError` (400).
 */
export function parseResolveArgs(args: unknown, types?: readonly string[]): ResolveToolArgs {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new ToolInputError('arguments must be an object with type and ids');
  }
  const record = args as Record<string, unknown>;
  const unknownKeys = Object.keys(record).filter((key) => key !== 'type' && key !== 'ids');
  if (unknownKeys.length > 0)
    throw new ToolInputError(`unknown argument: ${unknownKeys.join(', ')}`);
  if (typeof record.type !== 'string' || (types !== undefined && !types.includes(record.type))) {
    throw new ToolInputError(
      types === undefined ? 'type must be a string' : `type must be one of ${types.join(', ')}`,
    );
  }
  if (
    !Array.isArray(record.ids) ||
    record.ids.length === 0 ||
    record.ids.length > REFS_LIMITS.resolveIds ||
    !record.ids.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 128)
  ) {
    throw new ToolInputError(`ids must be a list of 1 to ${String(REFS_LIMITS.resolveIds)} ids`);
  }
  return { type: record.type, ids: [...new Set(record.ids as string[])] };
}

/**
 * Die Antwort eines Resolvers, geprueft, nur fuer die gefragten Ids. `null`,
 * wenn sie die Form gar nicht hat. Einzelne Eintraege ohne Titel oder mit
 * einem Pfad, der kein Pfad in der App ist, fallen weg.
 */
export function normalizeResolveResult(
  value: unknown,
  ids: readonly string[],
): Map<string, ResolvedObject> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const objects = (value as Record<string, unknown>).objects;
  if (!Array.isArray(objects)) return null;
  const wanted = new Set(ids);
  const result = new Map<string, ResolvedObject>();
  for (const entry of objects as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue;
    const o = entry as Record<string, unknown>;
    if (typeof o.id !== 'string' || !wanted.has(o.id) || result.has(o.id)) continue;
    if (typeof o.title !== 'string' || CONTROL.test(o.title.replace(/[\n\r\t]/g, ' '))) continue;
    const title = oneLine(o.title, REFS_LIMITS.title);
    if (title === '' || typeof o.path !== 'string' || !isAppRelativePath(o.path)) continue;
    const status = typeof o.status === 'string' ? oneLine(o.status, REFS_LIMITS.status) : '';
    const updatedAt =
      typeof o.updatedAt === 'string' && !Number.isNaN(new Date(o.updatedAt).getTime())
        ? new Date(o.updatedAt).toISOString()
        : new Date(0).toISOString();
    result.set(o.id, {
      id: o.id,
      title,
      path: o.path,
      ...(status === '' ? {} : { status }),
      updatedAt,
    });
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/* Outbox fuer Verweise                                                        */
/* -------------------------------------------------------------------------- */

export interface RefsOutboxOptions {
  /** Abfragen ausserhalb einer Transaktion (Pool). */
  readonly query: OutboxQuery;
  /** Default `refs_outbox`. */
  readonly table?: string;
  /** Praefix im Log. Default `[refs]`. */
  readonly name?: string;
  /** Fuer Tests: der Weg zur Plattform. Default `callAppTool('platform', 'set_refs', …)`. */
  readonly send?: (payload: SetRefsPayload) => Promise<unknown>;
  readonly retryIntervalMs?: number;
  readonly logger?: OutboxLogger;
}

export interface RefsOutbox extends Omit<Outbox, 'enqueue' | 'requeueClause'> {
  /**
   * Prueft die Meldung und reiht sie ein, je Quelle eine Zeile: Eine neuere
   * Meldung derselben Quelle ersetzt eine wartende. **Nur in der Transaktion
   * der Aenderung** aufrufen. Wirft `RefsInputError`, bevor etwas
   * geschrieben wird.
   */
  report(q: OutboxQuery, input: SetRefsInput | readonly SetRefsInput[]): Promise<void>;
}

/** Der Normalweg: ueber die Plattform, signiert mit dem Call-Secret der App. */
export function sendRefsToPlatform(payload: SetRefsPayload): Promise<unknown> {
  return callAppTool('platform', 'set_refs', {
    ...payload,
    targets: payload.targets.map((target) => ({ ...target })),
  });
}

/**
 * Die Outbox fuer `set_refs`. Die Tabelle legt die App per Migration an, wie
 * die Ereignis-Outbox (`createOutbox`), mit Schluessel `key` (die Quelle)
 * und Spalte `payload`.
 */
export function createRefsOutbox(options: RefsOutboxOptions): RefsOutbox {
  const send = options.send ?? sendRefsToPlatform;
  const outbox = createOutbox({
    name: options.name ?? '[refs]',
    table: options.table ?? REFS_OUTBOX_TABLE,
    query: options.query,
    ...(options.retryIntervalMs === undefined ? {} : { retryIntervalMs: options.retryIntervalMs }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    async deliver(entry) {
      // Noch einmal geprueft: Die Zeile kann aus einer aelteren Fassung stammen.
      await send(parseSetRefs(entry.payload));
    },
  });
  const { enqueue: _enqueue, requeueClause: _clause, ...rest } = outbox;
  return {
    ...rest,
    async report(q, input) {
      const list = (Array.isArray(input) ? input : [input]) as readonly SetRefsInput[];
      const parsed = list.map((entry) => parseSetRefs(entry));
      await outbox.enqueue(
        q,
        parsed.map((entry) => ({ key: entry.source, payload: entry })),
        { onConflict: 'requeue' },
      );
    },
  };
}

/** Der Verweis auf ein eigenes Objekt; Kurzform fuer Apps. */
export function ownRef(app: string, type: string, id: string): ObjectRef {
  const parsed = parseObjectRef(`${app}:${type}:${id}`);
  if (parsed === null) throw new RefsInputError(`${app}:${type}:${id} is not an object reference`);
  return parsed;
}
