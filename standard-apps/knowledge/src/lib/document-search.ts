import type { SearchHit, SearchToolResult } from '@openapps/sdk';
import type { Passage, Retriever } from './retriever';
import { SEARCH_LIMIT_MAX } from './schemas';
import { OWN_DOCUMENTS_ONLY } from './visibility';

/**
 * `documents.search` — Knowledge als eine Quelle der Suche ueber alle Apps
 * (ADR 0021), im festen Format der Plattform: ein Treffer je Dokument.
 *
 * Nur **eigene** Dokumente (ohne Quell-App), unabhaengig von den lesbaren
 * Apps des Aufrufers: Eine Wiki-Seite, die Knowledge abgeliefert bekam,
 * findet die Suche ueber alle Apps schon im Wiki selbst. Kaeme sie hier noch
 * einmal, stuende jede Seite doppelt in der Leiste.
 *
 * Ein eigenes Tool statt `search` umzubauen: `search` liefert Passagen fuer
 * Antworten mit Quellenangabe (RAG), ein Agent zitiert daraus. Diese Form
 * bleibt, wie sie ist.
 */
export async function searchOwnDocuments(
  retriever: Retriever,
  query: string,
  limit: number,
): Promise<SearchToolResult> {
  // Mehrere Passagen koennen aus einem Dokument kommen; also mehr holen und
  // je Dokument die beste behalten.
  const passages = await retriever.search(
    query,
    Math.min(limit * 3, SEARCH_LIMIT_MAX),
    OWN_DOCUMENTS_ONLY,
  );
  return { hits: documentHits(passages, limit) };
}

/** Je Dokument der beste Abschnitt, hoechstens `limit`, Reihenfolge wie geliefert. */
export function documentHits(passages: readonly Passage[], limit: number): SearchHit[] {
  const seen = new Set<string>();
  const hits: SearchHit[] = [];
  for (const passage of passages) {
    if (hits.length >= limit) break;
    // Doppelt abgesichert: Was einer anderen App gehoert, gehoert nicht hierher.
    if (passage.sourceApp !== null || seen.has(passage.documentId)) continue;
    seen.add(passage.documentId);
    hits.push({
      id: passage.documentId,
      title: passage.documentTitle,
      snippet: passage.excerpt.replace(/\s+/g, ' ').trim(),
      url: `/documents/${encodeURIComponent(passage.documentId)}`,
      kind: 'document',
    });
  }
  return hits;
}
