import { normalizeSearchResult } from '@openapps/sdk';
import { describe, expect, it, vi } from 'vitest';
import { documentHits, searchOwnDocuments } from '@/lib/document-search';
import type { Passage, Retriever } from '@/lib/retriever';

/**
 * `documents.search` (ADR 0021): Knowledge als Quelle der Suche ueber alle
 * Apps. Riskant ist, dass Inhalte einer anderen App hier auftauchen und so
 * an deren Rechten vorbei in der Leiste stehen. Deshalb zuerst das.
 */

function passage(documentId: string, sourceApp: string | null, chunk = '1'): Passage {
  return {
    chunkId: `${documentId}-${chunk}`,
    documentId,
    documentTitle: `Doc ${documentId}`,
    source: null,
    sourceApp,
    sourcePath: sourceApp === null ? null : '/pages/1',
    sourceUrl: null,
    ord: 0,
    score: 1,
    excerpt: 'Die «Reisekosten»\n werden erstattet',
    text: 'Die Reisekosten werden erstattet',
  };
}

describe('documents.search', () => {
  it('fragt den Retriever nur nach eigenen Dokumenten, egal was der Aufrufer lesen darf', async () => {
    const search = vi.fn<Retriever['search']>(async () => [passage('a', null)]);
    await searchOwnDocuments({ search }, 'reisekosten', 5);
    expect(search).toHaveBeenCalledWith('reisekosten', 15, { readableApps: null });
  });

  it('laesst Dokumente einer anderen App weg, auch wenn der Retriever sie liefert', () => {
    const hits = documentHits([passage('w', 'wiki'), passage('a', null)], 5);
    expect(hits.map((hit) => hit.id)).toEqual(['a']);
  });

  it('liefert ein Dokument nur einmal, im Format der Plattform', () => {
    const hits = documentHits(
      [passage('a', null, '1'), passage('a', null, '2'), passage('b', null), passage('c', null)],
      2,
    );
    expect(hits).toEqual([
      {
        id: 'a',
        title: 'Doc a',
        snippet: 'Die «Reisekosten» werden erstattet',
        url: '/documents/a',
        kind: 'document',
      },
      expect.objectContaining({ id: 'b', url: '/documents/b' }),
    ]);
    expect(normalizeSearchResult({ hits }, 5)).toHaveLength(2);
  });
});
