import type { QueryFn } from './db';
import { MARK_END, MARK_START } from './highlight';

/**
 * Die Suche hinter einer Schnittstelle. Heute gibt es eine Implementierung:
 * deutscher Postgres-Volltext (Postgres 16 ohne pgvector, kein
 * Embedding-Modell, keine externe API). Kommt pgvector dazu, ist das eine
 * zweite Implementierung von `Retriever` — Tools und UI bleiben, wie sie sind.
 */

export interface Passage {
  readonly chunkId: string;
  readonly documentId: string;
  readonly documentTitle: string;
  readonly source: string | null;
  /** Position des Abschnitts im Dokument, ab 0. */
  readonly ord: number;
  /** Rang. Nur innerhalb einer Antwort vergleichbar, nicht zwischen Implementierungen. */
  readonly score: number;
  /** Ausschnitt, Treffer in « und » markiert. Nie HTML. */
  readonly excerpt: string;
  /** Der volle Abschnitt. */
  readonly text: string;
}

export interface Retriever {
  /** Hoechstens `limit` Passagen, bester Treffer zuerst, ohne geloeschte Dokumente. */
  search(query: string, limit: number): Promise<Passage[]>;
}

/** Wie viele einzelne Woerter die ODER-Anfrage hoechstens nimmt. */
const MAX_FALLBACK_WORDS = 32;
/** Ab dieser Laenge sucht ein Wort der ODER-Anfrage auch als Wortanfang. */
const PREFIX_MIN_LENGTH = 4;

/**
 * Optionen fuer `ts_headline`. Treffer werden mit « und » markiert, nicht mit
 * HTML: die UI rendert sie als `<mark>`, ein Agent liest sie als Text.
 */
export const HEADLINE_OPTIONS =
  `StartSel="${MARK_START}", StopSel="${MARK_END}", ` +
  'MaxWords=40, MinWords=15, ShortWord=2, MaxFragments=2, FragmentDelimiter=" … "';

/**
 * Die zweite, weitere Anfrage: jedes Wort der Suche einzeln, mit ODER.
 *
 * Gibt einen `to_tsquery`-Ausdruck zurueck oder `null`, wenn kein Wort
 * uebrig bleibt. Sicher, weil nur Buchstaben- und Ziffernfolgen
 * hineinkommen — kein Operator aus der Eingabe erreicht `to_tsquery`.
 *
 * - Woerter mit vorangestelltem `-` schliesst die strenge Anfrage aus; hier
 *   fallen sie weg, statt sie zu suchen.
 * - `or` ist in `websearch_to_tsquery` ein Operator, kein Suchwort.
 * - Ab vier Buchstaben auch als Wortanfang (`reise:*`): Der deutsche Stemmer
 *   zerlegt keine Komposita, und so findet „Reise“ auch „Reisekosten“.
 */
export function orQueryText(query: string): string | null {
  const words: string[] = [];
  const seen = new Set<string>();
  for (const token of query.split(/\s+/)) {
    if (token === '' || token.startsWith('-')) continue;
    if (token.toLowerCase() === 'or') continue;
    for (const match of token.matchAll(/[\p{L}\p{N}]+/gu)) {
      const word = match[0].toLowerCase();
      if (seen.has(word)) continue;
      seen.add(word);
      words.push(word.length >= PREFIX_MIN_LENGTH ? `${word}:*` : word);
      if (words.length >= MAX_FALLBACK_WORDS) break;
    }
    if (words.length >= MAX_FALLBACK_WORDS) break;
  }
  return words.length === 0 ? null : words.join(' | ');
}

interface PassageRow extends Record<string, unknown> {
  chunk_id: string;
  document_id: string;
  title: string;
  source: string | null;
  ord: number;
  score: number;
  excerpt: string;
  text: string;
}

/**
 * Eine Abfrage fuer beide Stufen. `tsqueryFn` ist eine Konstante aus diesem
 * Modul, nie eine Eingabe. Erst werden die besten Abschnitte bestimmt, dann
 * nur fuer diese `ts_headline` gerechnet — das ist der teure Teil.
 *
 * Im Ausschnitt werden « und » aus dem Dokument selbst durch ‹ und › ersetzt,
 * damit sie nicht als Markierung gelesen werden. `text` bleibt unveraendert.
 */
function searchSql(tsqueryFn: 'websearch_to_tsquery' | 'to_tsquery'): string {
  return `
    with q as (select ${tsqueryFn}('german', $1) as query),
    hits as (
      select c.id, c.document_id, c.ord, c.text, d.title, d.source, d.created_at,
             ts_rank_cd(c.tsv, q.query) as score
        from q
        cross join chunks c
        join documents d on d.id = c.document_id
       where d.deleted_at is null
         and c.tsv @@ q.query
         and c.id <> all($4::uuid[])
       order by score desc, d.created_at desc, c.ord
       limit $2
    )
    select hits.id::text as chunk_id,
           hits.document_id::text as document_id,
           hits.title,
           hits.source,
           hits.ord,
           hits.score,
           ts_headline('german',
                       replace(replace(hits.text, '${MARK_START}', '‹'), '${MARK_END}', '›'),
                       q.query, $3) as excerpt,
           hits.text
      from hits
      cross join q
     order by hits.score desc, hits.created_at desc, hits.ord`;
}

const STRICT_SQL = searchSql('websearch_to_tsquery');
const FALLBACK_SQL = searchSql('to_tsquery');

const toPassage = (row: PassageRow): Passage => ({
  chunkId: row.chunk_id,
  documentId: row.document_id,
  documentTitle: row.title,
  source: row.source,
  ord: Number(row.ord),
  score: Math.round(Number(row.score) * 10_000) / 10_000,
  excerpt: row.excerpt,
  text: row.text,
});

/**
 * Postgres-Volltext, Sprache `german`.
 *
 * 1. Streng: `websearch_to_tsquery` — alle Woerter muessen vorkommen,
 *    Anfuehrungszeichen und `-wort` wirken wie in einer Websuche.
 * 2. Liefert das weniger als `limit`, ergaenzt eine ODER-Anfrage ueber die
 *    einzelnen Woerter (`orQueryText`). Treffer der ersten Stufe stehen immer
 *    vorn und kommen nicht doppelt.
 */
export function createFulltextRetriever(query: QueryFn): Retriever {
  return {
    async search(text, limit) {
      const strict = (await query<PassageRow>(STRICT_SQL, [text, limit, HEADLINE_OPTIONS, []])).map(
        toPassage,
      );
      if (strict.length >= limit) return strict;

      const orText = orQueryText(text);
      if (orText === null) return strict;

      const seen = strict.map((passage) => passage.chunkId);
      const extra = (
        await query<PassageRow>(FALLBACK_SQL, [orText, limit - strict.length, HEADLINE_OPTIONS, seen])
      ).map(toPassage);

      return mergePassages(strict, extra, limit);
    },
  };
}

/** Erst `first`, dann `second` ohne Dubletten, hoechstens `limit`. */
export function mergePassages(
  first: readonly Passage[],
  second: readonly Passage[],
  limit: number,
): Passage[] {
  const seen = new Set<string>();
  const merged: Passage[] = [];
  for (const passage of [...first, ...second]) {
    if (merged.length >= limit) break;
    if (seen.has(passage.chunkId)) continue;
    seen.add(passage.chunkId);
    merged.push(passage);
  }
  return merged;
}
