import { ToolInputError } from './tools.js';

/**
 * Das Such-Tool einer App fuer die Suche ueber alle Apps (ADR 0021).
 *
 * Eine App benennt es im Manifest (`"search": { "tool": "pages.search" }`).
 * Die Control Plane ruft es fuer jede Suche in der Leiste und fuer das
 * MCP-Tool `search` auf, mit genau diesen Argumenten, und erwartet genau
 * diese Antwort. Es gibt keinen zentralen Index: Die App sucht in ihren
 * eigenen Daten, mit der Identitaet des Aufrufers, wie bei jedem anderen Tool.
 *
 * Eingabe:  `{ "query": "angebot", "limit": 5 }`
 * Ausgabe:  `{ "hits": [{ "id", "title", "snippet"?, "url", "kind"? }] }`
 *
 * - `url` ist ein Pfad **in der App**, ohne ihren basePath: `/deals/42`,
 *   nicht `/crm/deals/42` und keine volle Adresse. Die Plattform setzt die
 *   Adresse der App davor. Was kein solcher Pfad ist, faellt weg.
 * - `snippet` ist Klartext, nie HTML. Treffer duerfen in `«` und `»` stehen.
 * - `kind` sagt, was der Treffer ist (`deal`, `contact`, `page` …), klein
 *   geschrieben, fuer die Anzeige.
 *
 * Eine App darf mehr Felder liefern (das Wiki liefert etwa `rank` und
 * `tags`); die Plattform nimmt nur diese.
 */

/** Hoechstlaenge des Suchtexts in Zeichen. */
export const SEARCH_QUERY_MAX_LENGTH = 200;

/** So viele Treffer fragt die Plattform hoechstens je App ab. */
export const SEARCH_LIMIT_MAX = 20;

/** Ohne Angabe so viele Treffer. */
export const SEARCH_LIMIT_DEFAULT = 5;

/** Laengen, ab denen die Plattform ein Feld kuerzt (Zeichen). */
export const SEARCH_HIT_LIMITS = Object.freeze({
  id: 200,
  title: 200,
  snippet: 300,
  url: 1000,
  kind: 40,
});

export interface SearchToolArgs {
  readonly query: string;
  readonly limit: number;
}

export interface SearchHit {
  /** Stabile Id in der App, z. B. die UUID des Deals. */
  readonly id: string;
  readonly title: string;
  /** Klartext um den Treffer, Treffer in `«` und `»`. */
  readonly snippet?: string;
  /** Pfad in der App ohne basePath, beginnt mit `/`. */
  readonly url: string;
  /** Art des Treffers, klein geschrieben, z. B. `deal`. */
  readonly kind?: string;
}

export interface SearchToolResult {
  readonly hits: readonly SearchHit[];
}

/**
 * Prueft die Argumente des Such-Tools: `query` (getrimmt, 1 bis 200
 * Zeichen) und `limit` (1 bis 20, Default 5). Andere Felder sind ein Fehler,
 * damit ein Tippfehler eines Agenten nicht still ignoriert wird. Wirft
 * `ToolInputError` (400) mit einer Meldung fuer den Aufrufer.
 */
export function parseSearchArgs(args: unknown): SearchToolArgs {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new ToolInputError('arguments must be an object with query and optional limit');
  }
  const record = args as Record<string, unknown>;
  const unknownKeys = Object.keys(record).filter((key) => key !== 'query' && key !== 'limit');
  if (unknownKeys.length > 0) {
    throw new ToolInputError(`unknown argument: ${unknownKeys.join(', ')}`);
  }
  if (typeof record.query !== 'string') {
    throw new ToolInputError('query must be a string');
  }
  const query = record.query.trim();
  if (query.length === 0) throw new ToolInputError('query must not be empty');
  if (query.length > SEARCH_QUERY_MAX_LENGTH) {
    throw new ToolInputError(`query must have at most ${SEARCH_QUERY_MAX_LENGTH} characters`);
  }
  const limit = record.limit ?? SEARCH_LIMIT_DEFAULT;
  if (
    typeof limit !== 'number' ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > SEARCH_LIMIT_MAX
  ) {
    throw new ToolInputError(`limit must be a whole number from 1 to ${SEARCH_LIMIT_MAX}`);
  }
  return { query, limit };
}

/**
 * Ist `url` ein Pfad in der App, den die Plattform gefahrlos hinter die
 * Adresse der App setzen kann? Ja nur fuer `/…` ohne Schema, ohne zweiten
 * Schraegstrich am Anfang (`//evil.example` waere eine fremde Adresse), ohne
 * Backslash, Leer- und Steuerzeichen und ohne `.`/`..` als Segment (sonst
 * zeigte der Link in eine andere App).
 */
export function isAppRelativePath(url: string): boolean {
  if (url.length === 0 || url.length > SEARCH_HIT_LIMITS.url) return false;
  if (!url.startsWith('/') || url.startsWith('//')) return false;
  // Leerzeichen und Steuerzeichen (U+0000 bis U+0020, U+007F) und Backslash.
  if (/[\u0000- \u007f\\]/.test(url)) return false;
  const path = url.split(/[?#]/, 1)[0] ?? '';
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return false;
  }
  if (decoded.includes('\\')) return false;
  return !decoded.split('/').some((segment) => segment === '.' || segment === '..');
}

/**
 * Die Antwort eines Such-Tools in der festen Form, oder `null`, wenn sie
 * diese Form gar nicht hat (kein Objekt, kein Array `hits`). Fuer die
 * Control Plane: Einzelne unbrauchbare Treffer (ohne Id, Titel oder mit
 * einer Adresse ausserhalb der App) fallen weg, zu lange Felder werden
 * gekuerzt, mehr als `maxHits` Treffer abgeschnitten. Wirft nie.
 */
export function normalizeSearchResult(value: unknown, maxHits: number): SearchHit[] | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const hits = (value as Record<string, unknown>).hits;
  if (!Array.isArray(hits)) return null;
  const result: SearchHit[] = [];
  const seen = new Set<string>();
  for (const entry of hits as unknown[]) {
    if (result.length >= maxHits) break;
    const hit = normalizeHit(entry);
    if (hit === null || seen.has(hit.id)) continue;
    seen.add(hit.id);
    result.push(hit);
  }
  return result;
}

function normalizeHit(entry: unknown): SearchHit | null {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null;
  const record = entry as Record<string, unknown>;
  const id = typeof record.id === 'number' ? String(record.id) : record.id;
  if (typeof id !== 'string' || id.trim() === '') return null;
  const title = oneLine(record.title, SEARCH_HIT_LIMITS.title);
  if (title === null) return null;
  if (typeof record.url !== 'string' || !isAppRelativePath(record.url)) return null;
  const snippet = oneLine(record.snippet, SEARCH_HIT_LIMITS.snippet);
  const kind = oneLine(record.kind, SEARCH_HIT_LIMITS.kind);
  return {
    id: id.slice(0, SEARCH_HIT_LIMITS.id),
    title,
    url: record.url,
    ...(snippet === null ? {} : { snippet }),
    ...(kind === null ? {} : { kind: kind.toLowerCase() }),
  };
}

/** Text auf eine Zeile, gekuerzt mit `…`. `null`, wenn leer oder kein Text. */
function oneLine(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  if (text === '') return null;
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
