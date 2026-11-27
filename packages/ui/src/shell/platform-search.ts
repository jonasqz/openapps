import { safeHref } from './platform.ts';

/**
 * Die Suche ueber alle Apps in der Leiste (ADR 0021). Die Typen sind
 * strukturell gleich der Antwort von `GET /_platform/search` der Control
 * Plane, ohne dass das Design System die Control Plane importiert (wie bei
 * der Navigation, ADR 0019).
 *
 * Die Leiste ruft den Pfad auf ihrem **eigenen** Origin auf: Auf dem Host der
 * Apps fuehrt das Gateway `/_platform/search` zur Control Plane, die die
 * Session aus dem Cookie liest. Kein CORS, kein zweites Cookie, und kein
 * Rechte-Code im Browser: Was zurueckkommt, durfte die Person schon sehen.
 */

/** Der reservierte Pfad der Plattform auf dem Host der Apps. */
export const PLATFORM_SEARCH_PATH = '/_platform/search';

/** Ab so vielen Zeichen fragt die Leiste die Apps. */
export const PLATFORM_SEARCH_MIN_QUERY = 2;

/** So lange wartet die Leiste nach dem letzten Tastendruck. */
export const PLATFORM_SEARCH_DEBOUNCE_MS = 250;

export interface PlatformSearchHit {
  id: string;
  title: string;
  snippet?: string;
  kind?: string;
  /** Volle Adresse zum Oeffnen; nur http(s) und `/…`, sonst faellt der Treffer weg. */
  href: string;
}

export interface PlatformSearchGroup {
  /** Technischer Name der App, z. B. `crm`. */
  app: string;
  /** Anzeigename der App, z. B. „CRM“. */
  title: string;
  hits: readonly PlatformSearchHit[];
}

export interface PlatformSearchFailure {
  app: string;
  title: string;
  /** `timeout`, `error` oder `invalid_response`. */
  reason: string;
}

export interface PlatformSearchResponse {
  results: readonly PlatformSearchGroup[];
  failed: readonly PlatformSearchFailure[];
}

/** Eine Suche: Suchtext rein, gruppierte Treffer raus. Wirft bei Fehlern. */
export type PlatformSearch = (query: string, signal: AbortSignal) => Promise<PlatformSearchResponse>;

/** Die Suche antwortet nicht brauchbar. `code` fuer Tests und Log, kein Oberflaechentext. */
export class PlatformSearchError extends Error {
  readonly code: 'http' | 'invalid';
  readonly status: number | null;

  constructor(code: 'http' | 'invalid', status: number | null = null) {
    super(`platform search failed: ${code}${status === null ? '' : ` ${String(status)}`}`);
    this.name = 'PlatformSearchError';
    this.code = code;
    this.status = status;
  }
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed === '' ? null : trimmed.slice(0, max);
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Prueft die Antwort der Plattform und macht sie anzeigbar. `null`, wenn sie
 * die Form gar nicht hat. Einzelne Treffer ohne Titel oder mit einer
 * Adresse, die kein http(s) und kein `/…` ist, fallen weg.
 */
export function parsePlatformSearchResponse(value: unknown): PlatformSearchResponse | null {
  const body = record(value);
  if (body === null || !Array.isArray(body.results)) return null;
  const results: PlatformSearchGroup[] = [];
  for (const entry of body.results as unknown[]) {
    const group = record(entry);
    const app = text(group?.app, 64);
    if (group === null || app === null || !Array.isArray(group.hits)) continue;
    const hits: PlatformSearchHit[] = [];
    for (const raw of group.hits as unknown[]) {
      const hit = record(raw);
      const id = text(hit?.id, 200);
      const title = text(hit?.title, 200);
      const href = safeHref(typeof hit?.href === 'string' ? hit.href : null);
      if (hit === null || id === null || title === null || href === null) continue;
      const snippet = text(hit.snippet, 300);
      const kind = text(hit.kind, 40);
      hits.push({
        id,
        title,
        href,
        ...(snippet === null ? {} : { snippet }),
        ...(kind === null ? {} : { kind }),
      });
    }
    if (hits.length > 0) results.push({ app, title: text(group.title, 64) ?? app, hits });
  }
  const failed: PlatformSearchFailure[] = [];
  for (const entry of Array.isArray(body.failed) ? (body.failed as unknown[]) : []) {
    const failure = record(entry);
    const app = text(failure?.app, 64);
    if (failure === null || app === null) continue;
    failed.push({ app, title: text(failure.title, 64) ?? app, reason: text(failure.reason, 40) ?? 'error' });
  }
  return { results, failed };
}

export interface CreatePlatformSearchOptions {
  /** Default `/_platform/search` auf dem eigenen Origin. */
  path?: string;
  /** Fuer Tests. Default: das globale `fetch`. */
  fetch?: typeof fetch;
}

/**
 * Die Suche ueber `GET <path>?q=…`, mit dem Cookie der Person (gleicher
 * Origin). Jede Antwort ausser 2xx mit brauchbarem Inhalt ist ein Fehler.
 */
export function createPlatformSearch(options: CreatePlatformSearchOptions = {}): PlatformSearch {
  const path = options.path ?? PLATFORM_SEARCH_PATH;
  return async (query, signal) => {
    const doFetch = options.fetch ?? globalThis.fetch;
    const separator = path.includes('?') ? '&' : '?';
    const response = await doFetch(`${path}${separator}q=${encodeURIComponent(query)}`, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
      signal,
    });
    if (!response.ok) throw new PlatformSearchError('http', response.status);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new PlatformSearchError('invalid');
    }
    const parsed = parsePlatformSearchResponse(body);
    if (parsed === null) throw new PlatformSearchError('invalid');
    return parsed;
  };
}

/** Treffermarken `«` und `»` aus dem Ausschnitt, fuer die Anzeige als Klartext. */
export function plainSnippet(snippet: string): string {
  return snippet.replace(/[«»]/g, '');
}
