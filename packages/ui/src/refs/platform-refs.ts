import { createPlatformSearch, type PlatformSearch } from '../shell/platform-search.ts';
import { safeHref } from '../shell/platform.ts';
import { strings } from '../strings.ts';

/**
 * Verweise zwischen Apps im Browser (ADR 0023 F, G). Die Typen sind
 * strukturell gleich den Antworten der Control Plane unter
 * `/_platform/refs/…` und `/_platform/people`, ohne dass das Design System
 * die Control Plane oder das SDK importiert (Grenze aus ADR 0019).
 *
 * Alles laeuft auf dem **eigenen** Origin der App: Das Gateway fuehrt
 * `/_platform/…` zur Control Plane, die die Person aus der Session liest.
 * Kein CORS, kein zweites Cookie, kein Rechte-Code im Browser, und der
 * Server der App ist nicht beteiligt.
 *
 * Die Bausteine (`RefChip`, `MentionPicker`, `BacklinksPanel`) bekommen
 * diese Funktionen als Props; eine App kann sie fuer Tests ersetzen.
 */

export const PLATFORM_REFS_RESOLVE_PATH = '/_platform/refs/resolve';
export const PLATFORM_REFS_BACKLINKS_PATH = '/_platform/refs/backlinks';
export const PLATFORM_REFS_ACTIONS_PATH = '/_platform/refs/actions';
export const PLATFORM_PEOPLE_PATH = '/_platform/people';

/** Hoechstens so viele Verweise je Anfrage (wie die Control Plane). */
export const REF_RESOLVE_BATCH_MAX = 100;

export type RefObjectKind = 'object' | 'human' | 'group' | 'agent';

/** Ein aufgeloester Verweis. Bei Personen nur, was im Verweis selbst steht. */
export interface ResolvedRef {
  ref: string;
  state: 'resolved';
  kind: RefObjectKind;
  title: string;
  /** Anzeigename der Ziel-App, nur bei Objekten. */
  appTitle?: string;
  /** Adresse zum Oeffnen; nur http(s) und `/…`. */
  href?: string;
  status?: string;
}

/** Nicht aufgeloest: nur der Zustand, kein Titel, kein App-Name. */
export interface UnresolvedRef {
  ref: string;
  state: 'restricted' | 'not_found' | 'unavailable';
}

export type RefResolution = ResolvedRef | UnresolvedRef;

/** Ein Verweis aufloesen. Wirft bei einem Fehler der Plattform. */
export type ResolveRef = (ref: string) => Promise<RefResolution>;

/** Die Plattform antwortet nicht brauchbar. `code` fuer Tests und Log, kein Oberflaechentext. */
export class PlatformRefsError extends Error {
  readonly code: 'http' | 'invalid';
  readonly status: number | null;

  constructor(code: 'http' | 'invalid', status: number | null = null) {
    super(`platform references failed: ${code}${status === null ? '' : ` ${String(status)}`}`);
    this.name = 'PlatformRefsError';
    this.code = code;
    this.status = status;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed === '' ? null : trimmed.slice(0, max);
}

const KINDS: readonly RefObjectKind[] = ['object', 'human', 'group', 'agent'];
const UNRESOLVED: readonly UnresolvedRef['state'][] = ['restricted', 'not_found', 'unavailable'];

/** Prueft einen Eintrag aus `results`. `null`, wenn er die Form nicht hat. */
export function parseRefResolution(value: unknown): RefResolution | null {
  const entry = record(value);
  const ref = text(entry?.ref, 400);
  if (entry === null || ref === null) return null;
  if (UNRESOLVED.includes(entry.state as UnresolvedRef['state'])) {
    // Nichts weiter uebernehmen, auch wenn die Antwort mehr truege.
    return { ref, state: entry.state as UnresolvedRef['state'] };
  }
  if (entry.state !== 'resolved') return null;
  const title = text(entry.title, 200);
  const kind = KINDS.includes(entry.kind as RefObjectKind) ? (entry.kind as RefObjectKind) : null;
  if (title === null || kind === null) return null;
  const href = safeHref(typeof entry.href === 'string' ? entry.href : null);
  const appTitle = text(entry.appTitle, 64);
  const status = text(entry.status, 40);
  return {
    ref,
    state: 'resolved',
    kind,
    title,
    ...(href === null ? {} : { href }),
    ...(appTitle === null ? {} : { appTitle }),
    ...(status === null ? {} : { status }),
  };
}

export interface PlatformRefsOptions {
  /** Fuer Tests. Default: das globale `fetch`. */
  fetch?: typeof fetch;
}

async function getJson(
  options: PlatformRefsOptions,
  url: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const doFetch = options.fetch ?? globalThis.fetch;
  const response = await doFetch(url, {
    method: 'GET',
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new PlatformRefsError('http', response.status);
  try {
    return await response.json();
  } catch {
    throw new PlatformRefsError('invalid');
  }
}

/**
 * Ein Aufloeser mit Buendelung: Alle Verweise, die im selben Augenblick
 * gefragt werden (alle Chips einer Seite), gehen in **einer** Anfrage. Jeder
 * Verweis wird je Seite nur einmal gefragt; ein Fehler wird nicht gemerkt,
 * damit ein neuer Versuch die Plattform wieder fragt.
 */
export function createRefResolver(
  options: PlatformRefsOptions & { path?: string; delayMs?: number } = {},
): ResolveRef {
  const path = options.path ?? PLATFORM_REFS_RESOLVE_PATH;
  const delayMs = options.delayMs ?? 10;
  const known = new Map<string, Promise<RefResolution>>();
  let pending: { ref: string; resolve: (r: RefResolution) => void; reject: (e: unknown) => void }[] =
    [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = async (): Promise<void> => {
    timer = null;
    const batch = pending;
    pending = [];
    for (let start = 0; start < batch.length; start += REF_RESOLVE_BATCH_MAX) {
      const chunk = batch.slice(start, start + REF_RESOLVE_BATCH_MAX);
      const params = new URLSearchParams();
      for (const entry of chunk) params.append('ref', entry.ref);
      const separator = path.includes('?') ? '&' : '?';
      try {
        const body = record(await getJson(options, `${path}${separator}${params.toString()}`));
        if (body === null || !Array.isArray(body.results)) throw new PlatformRefsError('invalid');
        const byRef = new Map<string, RefResolution>();
        for (const raw of body.results as unknown[]) {
          const parsed = parseRefResolution(raw);
          if (parsed !== null) byRef.set(parsed.ref, parsed);
        }
        for (const entry of chunk) {
          entry.resolve(byRef.get(entry.ref) ?? { ref: entry.ref, state: 'unavailable' });
        }
      } catch (error) {
        for (const entry of chunk) {
          known.delete(entry.ref);
          entry.reject(error);
        }
      }
    }
  };

  return (ref) => {
    const cached = known.get(ref);
    if (cached !== undefined) return cached;
    const promise = new Promise<RefResolution>((resolve, reject) => {
      pending.push({ ref, resolve, reject });
      timer ??= setTimeout(() => void flush(), delayMs);
    });
    known.set(ref, promise);
    return promise;
  };
}

/* -------------------------------------------------------------------------- */
/* Rueckverweise                                                               */
/* -------------------------------------------------------------------------- */

export type BacklinkKind = 'mention' | 'link' | 'derived';

export interface BacklinkItem {
  source: string;
  kind: BacklinkKind;
  /** Anzeigename der Quell-App. */
  appTitle: string;
  /** Die aufgeloeste Quelle, mit Titel und Adresse, wenn sie aufgeloest werden konnte. */
  resolution: RefResolution;
}

export type LoadBacklinks = () => Promise<readonly BacklinkItem[]>;

const BACKLINK_KINDS: readonly BacklinkKind[] = ['mention', 'link', 'derived'];

/**
 * Die Rueckverweise eines Objekts, mit aufgeloesten Quellen. Die Plattform
 * liefert nur, was die Person in beiden Apps lesen darf.
 */
export function createBacklinksLoader(
  ref: string,
  options: PlatformRefsOptions & { path?: string; resolve?: ResolveRef } = {},
): LoadBacklinks {
  const path = options.path ?? PLATFORM_REFS_BACKLINKS_PATH;
  const resolve = options.resolve ?? createRefResolver(options);
  return async () => {
    const body = record(await getJson(options, `${path}?ref=${encodeURIComponent(ref)}`));
    if (body === null || !Array.isArray(body.backlinks)) throw new PlatformRefsError('invalid');
    const entries: { source: string; kind: BacklinkKind; appTitle: string }[] = [];
    for (const raw of body.backlinks as unknown[]) {
      const entry = record(raw);
      const source = text(entry?.source, 400);
      const kind = BACKLINK_KINDS.includes(entry?.kind as BacklinkKind)
        ? (entry?.kind as BacklinkKind)
        : null;
      if (source === null || kind === null) continue;
      entries.push({ source, kind, appTitle: text(entry?.appTitle, 64) ?? '' });
    }
    return Promise.all(
      entries.map(async (entry) => ({
        ...entry,
        resolution: await resolve(entry.source).catch(
          (): RefResolution => ({ ref: entry.source, state: 'unavailable' }),
        ),
      })),
    );
  };
}

/* -------------------------------------------------------------------------- */
/* Aktionen                                                                    */
/* -------------------------------------------------------------------------- */

export interface RefActionItem {
  app: string;
  appTitle: string;
  name: string;
  title: string;
  /** Die Seite in der Ziel-App, auf der die Person bestaetigt. */
  href: string;
}

export type LoadActions = (excerpt?: string) => Promise<readonly RefActionItem[]>;

/** Die Aktionen „aus X wird Y“ fuer ein Objekt, nur mit Adresse (Weg der Person). */
export function createActionsLoader(
  ref: string,
  options: PlatformRefsOptions & { path?: string } = {},
): LoadActions {
  const path = options.path ?? PLATFORM_REFS_ACTIONS_PATH;
  return async (excerpt) => {
    const params = new URLSearchParams({ ref });
    if (excerpt !== undefined && excerpt.trim() !== '') params.set('excerpt', excerpt.slice(0, 2000));
    const body = record(await getJson(options, `${path}?${params.toString()}`));
    if (body === null || !Array.isArray(body.actions)) throw new PlatformRefsError('invalid');
    const actions: RefActionItem[] = [];
    for (const raw of body.actions as unknown[]) {
      const entry = record(raw);
      const href = safeHref(typeof entry?.href === 'string' ? entry.href : null);
      const title = text(entry?.title, 60);
      const app = text(entry?.app, 64);
      const name = text(entry?.name, 64);
      if (href === null || title === null || app === null || name === null) continue;
      actions.push({ app, name, title, href, appTitle: text(entry?.appTitle, 64) ?? app });
    }
    return actions;
  };
}

/* -------------------------------------------------------------------------- */
/* Picker: Personen und Objekte                                                */
/* -------------------------------------------------------------------------- */

export type MentionOptionKind = 'human' | 'agent' | 'object';

export interface MentionOption {
  /** Der Verweis, der als `@{ref}` eingefuegt wird. */
  ref: string;
  kind: MentionOptionKind;
  label: string;
  /** E-Mail, Agent-Name oder App und Art. */
  detail?: string;
}

export type MentionSearch = (
  query: string,
  signal: AbortSignal,
) => Promise<readonly MentionOption[]>;

/**
 * Personen und Agents mit Lesezugriff auf `app` (`/_platform/people`) und
 * Objekte aus der Suche ueber alle Apps (ADR 0021), soweit ihre Treffer
 * einen Verweis tragen. Scheitert nur eine der beiden Quellen, kommt die
 * andere trotzdem; scheitern beide, wirft es.
 */
export function createMentionSearch(
  app: string,
  options: PlatformRefsOptions & { peoplePath?: string; search?: PlatformSearch | null } = {},
): MentionSearch {
  const peoplePath = options.peoplePath ?? PLATFORM_PEOPLE_PATH;
  const search =
    options.search === undefined
      ? createPlatformSearch(options.fetch === undefined ? {} : { fetch: options.fetch })
      : options.search;
  return async (query, signal) => {
    const people = (async (): Promise<MentionOption[]> => {
      const params = new URLSearchParams({ app, q: query });
      const body = record(await getJson(options, `${peoplePath}?${params.toString()}`, signal));
      if (body === null || !Array.isArray(body.people)) throw new PlatformRefsError('invalid');
      const found: MentionOption[] = [];
      for (const raw of body.people as unknown[]) {
        const entry = record(raw);
        const ref = text(entry?.ref, 400);
        const label = text(entry?.label, 200);
        const kind = entry?.kind === 'agent' ? 'agent' : entry?.kind === 'human' ? 'human' : null;
        if (ref === null || label === null || kind === null) continue;
        const detail = text(entry?.detail, 200);
        found.push({ ref, kind, label, ...(detail === null || detail === label ? {} : { detail }) });
      }
      return found;
    })();
    const objects = (async (): Promise<MentionOption[]> => {
      if (search === null || query.trim().length < 2) return [];
      const result = await search(query, signal);
      return result.results.flatMap((group) =>
        group.hits.flatMap((hit) =>
          hit.ref === undefined
            ? []
            : [
                {
                  ref: hit.ref,
                  kind: 'object' as const,
                  label: hit.title,
                  detail:
                    hit.kind === undefined
                      ? group.title
                      : strings.refs.objectDetail(group.title, hit.kind),
                },
              ],
        ),
      );
    })();
    const [peopleResult, objectsResult] = await Promise.allSettled([people, objects]);
    if (peopleResult.status === 'rejected' && objectsResult.status === 'rejected') {
      throw peopleResult.reason;
    }
    return [
      ...(peopleResult.status === 'fulfilled' ? peopleResult.value : []),
      ...(objectsResult.status === 'fulfilled' ? objectsResult.value : []),
    ];
  };
}

/** Die Schreibweise im Text (ADR 0023 A): `@{ref}`. */
export function refToken(ref: string): string {
  return `@{${ref}}`;
}
