import type { QueryFn } from './db';
import { MARK_END, MARK_START } from './highlight';
import { sourceUrlFor, visibleSourceApps, type Visibility } from './visibility';

/**
 * Die Suche hinter einer Schnittstelle. Heute gibt es eine Implementierung:
 * Postgres-Volltext, deutsch und englisch (Postgres 16 ohne pgvector, kein
 * Embedding-Modell, keine externe API). Kommt pgvector dazu, ist das eine
 * zweite Implementierung von `Retriever` — Tools und UI bleiben, wie sie sind.
 *
 * Die Sichtbarkeit (ADR 0020) ist Pflichtargument jeder Implementierung:
 * Eine Suche ohne sie gibt es nicht, auch nicht aus Versehen.
 */

export interface Passage {
  readonly chunkId: string;
  readonly documentId: string;
  readonly documentTitle: string;
  readonly source: string | null;
  /** App, aus der das Dokument kommt. `null`: in Knowledge angelegt. */
  readonly sourceApp: string | null;
  /** Pfad in der Quell-App fuer den Link zurueck. */
  readonly sourcePath: string | null;
  /** Adresse zurueck zur Quelle, falls bekannt. */
  readonly sourceUrl: string | null;
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
  /**
   * Hoechstens `limit` Passagen, bester Treffer zuerst, ohne geloeschte
   * Dokumente und ohne Dokumente aus Apps, die `visibility` nicht nennt.
   */
  search(query: string, limit: number, visibility: Visibility): Promise<Passage[]>;
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
 * - Ab vier Buchstaben auch als Wortanfang (`mile:*`): Der Stemmer zerlegt
 *   keine zusammengesetzten Woerter, und so findet „mile“ auch „mileage“.
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
  source_app: string | null;
  source_path: string | null;
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
 * Zwei Woerterbuecher (ADR 0020): Die Anfrage geht als englische und als
 * deutsche Anfrage gegen `tsv` und `tsv_de`. Ein Abschnitt trifft, wenn eine
 * der beiden trifft. Der Rang ist der bessere der beiden, nicht die Summe:
 * Ein Wort, das beide Woerterbuecher gleich stammen (Namen, Zahlen), zaehlt
 * so nicht doppelt. Der Ausschnitt kommt aus der Sprache mit dem besseren
 * Rang, damit er die Treffer markiert, die den Rang ergeben haben.
 *
 * `$5` ist die Liste der sichtbaren Quell-Apps (`text[]`, leer: nur eigene
 * Dokumente). Die Bedingung steht in `hits`, also vor dem `limit`: Ein nicht
 * sichtbarer Treffer verdraengt keinen sichtbaren.
 *
 * Im Ausschnitt werden « und » aus dem Dokument selbst durch ‹ und › ersetzt,
 * damit sie nicht als Markierung gelesen werden. `text` bleibt unveraendert.
 */
function searchSql(tsqueryFn: 'websearch_to_tsquery' | 'to_tsquery'): string {
  return `
    with q as (
      select ${tsqueryFn}('english', $1) as en,
             ${tsqueryFn}('german', $1) as de
    ),
    hits as (
      select c.id, c.document_id, c.ord, c.text, d.title, d.source, d.source_app,
             d.source_path, d.created_at,
             ts_rank_cd(c.tsv, q.en) as score_en,
             ts_rank_cd(c.tsv_de, q.de) as score_de,
             greatest(ts_rank_cd(c.tsv, q.en), ts_rank_cd(c.tsv_de, q.de)) as score
        from q
        cross join chunks c
        join documents d on d.id = c.document_id
       where d.deleted_at is null
         and (c.tsv @@ q.en or c.tsv_de @@ q.de)
         and c.id <> all($4::uuid[])
         and (d.source_app is null or d.source_app = any($5::text[]))
       order by score desc, d.created_at desc, c.ord
       limit $2
    )
    select hits.id::text as chunk_id,
           hits.document_id::text as document_id,
           hits.title,
           hits.source,
           hits.source_app,
           hits.source_path,
           hits.ord,
           hits.score,
           case when hits.score_de > hits.score_en
                then ts_headline('german',
                       replace(replace(hits.text, '${MARK_START}', '‹'), '${MARK_END}', '›'),
                       q.de, $3)
                else ts_headline('english',
                       replace(replace(hits.text, '${MARK_START}', '‹'), '${MARK_END}', '›'),
                       q.en, $3)
           end as excerpt,
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
  sourceApp: row.source_app,
  sourcePath: row.source_path,
  sourceUrl: sourceUrlFor(row.source_app, row.source_path),
  ord: Number(row.ord),
  score: Math.round(Number(row.score) * 10_000) / 10_000,
  excerpt: row.excerpt,
  text: row.text,
});

/**
 * Postgres-Volltext, Sprachen `english` und `german`.
 *
 * 1. Streng: `websearch_to_tsquery` — alle Woerter muessen vorkommen,
 *    Anfuehrungszeichen und `-wort` wirken wie in einer Websuche.
 * 2. Liefert das weniger als `limit`, ergaenzt eine ODER-Anfrage ueber die
 *    einzelnen Woerter (`orQueryText`). Treffer der ersten Stufe stehen immer
 *    vorn und kommen nicht doppelt.
 */
export function createFulltextRetriever(query: QueryFn): Retriever {
  return {
    async search(text, limit, visibility) {
      const apps = visibleSourceApps(visibility);
      const strict = (
        await query<PassageRow>(STRICT_SQL, [text, limit, HEADLINE_OPTIONS, [], apps])
      ).map(toPassage);
      if (strict.length >= limit) return strict;

      const orText = orQueryText(text);
      if (orText === null) return strict;

      const seen = strict.map((passage) => passage.chunkId);
      const extra = (
        await query<PassageRow>(FALLBACK_SQL, [
          orText,
          limit - strict.length,
          HEADLINE_OPTIONS,
          seen,
          apps,
        ])
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
