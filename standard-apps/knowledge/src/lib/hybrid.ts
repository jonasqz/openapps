import type { QueryFn } from './db';
import { coverage, readState, recordModel, vectorLiteral, vectorReady } from './embeddings';
import { modelKeyOf, type PlatformModels } from './platform-models';
import { HEADLINE_OPTIONS, orQueryText, type Passage, type Retriever } from './retriever';
import { MARK_END, MARK_START } from './highlight';
import { sourceUrlFor, visibleSourceApps, type Visibility } from './visibility';

/**
 * Die hybride Suche (ADR 0025 C): Volltext wie bisher und Vektor, beide mit
 * **derselben Sichtbarkeit vor dem Ranking**, zusammengefuehrt mit Reciprocal
 * Rank Fusion. Ein Abschnitt, den der Aufrufer nicht sehen darf, steht in
 * keiner der beiden Listen; die Bedingung sitzt in beiden Abfragen im
 * `where`, vor `order by` und `limit`.
 *
 * Der Vektor-Teil ist nur an, wenn
 *
 * 1. ein Embedding-Modell bekannt ist (Zustand aus der Warteschlange),
 * 2. jeder einbettbare sichtbare Abschnitt einen Vektor dieser Kennung hat
 *    (sonst verschoebe ein halb eingebetteter Bestand die Rangfolge),
 * 3. die Suchanfrage selbst einen Vektor derselben Kennung bekommt.
 *
 * Fehlt eines davon, ist das Ergebnis genau das des Volltexts, mit denselben
 * Argumenten wie in 0.2: Ohne Konfiguration aendert sich nichts, nicht einmal
 * ein Aufruf an die Plattform. Kein Fehler des Anbieters erreicht den
 * Aufrufer; die Suche antwortet dann nur mit dem Volltext.
 */

/** Der Ausgleich in RRF (Cormack et al. 2009): 60, wie ueblich. */
export const RRF_K = 60;
/** Die Suchanfrage wartet hoechstens so lange auf ihren Vektor. */
export const QUERY_EMBED_TIMEOUT_MS = 3_000;
/** Ausschnitt eines Abschnitts, den nur der Vektor fand und der nichts markiert. */
const PLAIN_EXCERPT_CHARS = 300;

/**
 * Reciprocal Rank Fusion: je Liste `1 / (k + rang)`, summiert. Ein Abschnitt
 * in beiden Listen nimmt die Fassung aus `first` (der Volltext hat den
 * besseren Ausschnitt). Gleichstand: Reihenfolge aus `first`, dann `second`.
 */
export function reciprocalRankFusion(
  first: readonly Passage[],
  second: readonly Passage[],
  limit: number,
  k: number = RRF_K,
): Passage[] {
  const entries = new Map<string, { passage: Passage; score: number; order: number }>();
  let order = 0;
  for (const list of [first, second]) {
    list.forEach((passage, index) => {
      const add = 1 / (k + index + 1);
      const known = entries.get(passage.chunkId);
      if (known === undefined) {
        entries.set(passage.chunkId, { passage, score: add, order: order++ });
      } else {
        known.score += add;
      }
    });
  }
  return [...entries.values()]
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map(({ passage, score }) => ({
      ...passage,
      score: Math.round(score * 1_000_000) / 1_000_000,
    }));
}

interface VectorRow extends Record<string, unknown> {
  chunk_id: string;
  document_id: string;
  title: string;
  source: string | null;
  source_app: string | null;
  source_path: string | null;
  ord: number;
  distance: number;
  excerpt: string;
  text: string;
}

/**
 * Die Vektor-Liste. `$3` ist die Liste der sichtbaren Quell-Apps, dieselbe
 * Bedingung wie im Volltext (`retriever.ts`). Exakte Suche, ohne ANN-Index
 * (ADR 0025 B). Der Ausschnitt markiert Woerter der Anfrage mit dem
 * Woerterbuch `simple` (keine Stammform, Wortanfang ab vier Buchstaben), sonst
 * ist er der Anfang des Abschnitts. Operator und Typ voll qualifiziert.
 */
const VECTOR_SQL = `
  with q as (select $1::extensions.vector as v)
  select c.id::text as chunk_id,
         c.document_id::text as document_id,
         d.title,
         d.source,
         d.source_app,
         d.source_path,
         c.ord,
         (e.embedding OPERATOR(extensions.<=>) q.v) as distance,
         coalesce(
           ts_headline('simple',
             replace(replace(c.text, '${MARK_START}', '‹'), '${MARK_END}', '›'),
             to_tsquery('simple', $5), $6),
           left(c.text, ${String(PLAIN_EXCERPT_CHARS)})
         ) as excerpt,
         c.text
    from q
    cross join chunk_embeddings e
    join chunks c on c.id = e.chunk_id
    join documents d on d.id = c.document_id
   where e.model_key = $2
     and e.embedding is not null
     and d.deleted_at is null
     and (d.source_app is null or d.source_app = any($3::text[]))
   order by distance, d.created_at desc, c.ord
   limit $4`;

/** Die Vektor-Suche allein, mit Pflicht-Sichtbarkeit. Fuer den Retriever und die Tests. */
export async function vectorSearch(
  query: QueryFn,
  input: {
    readonly vector: readonly number[];
    readonly modelKey: string;
    readonly text: string;
    readonly limit: number;
    readonly visibility: Visibility;
  },
): Promise<Passage[]> {
  const rows = await query<VectorRow>(VECTOR_SQL, [
    vectorLiteral(input.vector),
    input.modelKey,
    visibleSourceApps(input.visibility),
    input.limit,
    orQueryText(input.text),
    HEADLINE_OPTIONS,
  ]);
  return rows.map((row) => ({
    chunkId: row.chunk_id,
    documentId: row.document_id,
    documentTitle: row.title,
    source: row.source,
    sourceApp: row.source_app,
    sourcePath: row.source_path,
    sourceUrl: sourceUrlFor(row.source_app, row.source_path),
    ord: Number(row.ord),
    score: Math.round((1 - Number(row.distance)) * 10_000) / 10_000,
    excerpt: row.excerpt,
    text: row.text,
  }));
}

/** Wie viele Kandidaten je Liste in die Fusion gehen. */
export function candidatePool(limit: number): number {
  return Math.min(Math.max(limit * 3, 20), 60);
}

export interface HybridDeps {
  readonly query: QueryFn;
  readonly fulltext: Retriever;
  readonly models: () => PlatformModels;
  readonly warn?: (line: string) => void;
}

/** Warum der Vektor-Teil bei einer Suche aus war. Fuer Tests und Log. */
export type VectorSkip =
  | 'no_model'
  | 'incomplete'
  | 'query_not_embedded'
  | 'model_changed'
  | 'failed';

export interface HybridRetriever extends Retriever {
  /** Die letzte Entscheidung, `null`: hybrid. Nur zur Beobachtung. */
  lastSkip(): VectorSkip | null;
}

export function createHybridRetriever(deps: HybridDeps): HybridRetriever {
  let skipped: VectorSkip | null = null;
  let warned = false;
  const warn =
    deps.warn ??
    ((line: string) => {
      console.warn(`[knowledge] ${line}`);
    });

  const fulltextOnly = (
    reason: VectorSkip,
    text: string,
    limit: number,
    visibility: Visibility,
  ): Promise<Passage[]> => {
    skipped = reason;
    // Genau der Aufruf aus 0.2: dieselben Argumente, dasselbe Ergebnis.
    return deps.fulltext.search(text, limit, visibility);
  };

  return {
    lastSkip: () => skipped,
    async search(text, limit, visibility) {
      const state = await readState(deps.query);
      const key = state.modelKey;
      if (key === null) return fulltextOnly('no_model', text, limit, visibility);

      if (!vectorReady(await coverage(deps.query, key, visibility))) {
        return fulltextOnly('incomplete', text, limit, visibility);
      }

      const embedded = await deps.models().embed([{ id: 'query', sourceApp: 'knowledge', text }], {
        timeoutMs: QUERY_EMBED_TIMEOUT_MS,
      });
      if (embedded.status !== 'ok') {
        if (embedded.status === 'not_configured') await recordModel(deps.query, null);
        return fulltextOnly('query_not_embedded', text, limit, visibility);
      }
      if (modelKeyOf(embedded.model) !== key) {
        // Das Modell wurde gewechselt. Bis die Warteschlange alles neu
        // berechnet hat, nur Volltext (ADR 0025 D).
        await recordModel(deps.query, embedded.model);
        return fulltextOnly('model_changed', text, limit, visibility);
      }
      const vector = embedded.embeddings.find((entry) => entry.id === 'query')?.vector;
      if (vector === undefined) return fulltextOnly('query_not_embedded', text, limit, visibility);

      const pool = candidatePool(limit);
      try {
        const [fulltext, vectors] = await Promise.all([
          deps.fulltext.search(text, pool, visibility),
          vectorSearch(deps.query, { vector, modelKey: key, text, limit: pool, visibility }),
        ]);
        skipped = null;
        warned = false;
        return reciprocalRankFusion(fulltext, vectors, limit);
      } catch (error) {
        // Etwa eine andere Dimension als gespeichert. Die Suche antwortet
        // trotzdem; einmal im Log, nicht je Anfrage.
        if (!warned) {
          warned = true;
          const name = error instanceof Error ? error.name : 'error';
          warn(`vector search failed (${name}); searching with full text only`);
        }
        return fulltextOnly('failed', text, limit, visibility);
      }
    },
  };
}
