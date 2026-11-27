import { describe, expect, it } from 'vitest';
import {
  isAppRelativePath,
  normalizeSearchResult,
  parseSearchArgs,
  SEARCH_HIT_LIMITS,
  SEARCH_LIMIT_DEFAULT,
  ToolInputError,
} from '../src/index.js';

/**
 * Das feste Format des Such-Tools (ADR 0021). Zuerst das Riskante: Was eine
 * App als Adresse liefert, wird zu einem Link in der Leiste jeder anderen
 * App. Eine fremde Adresse darf daraus nie werden.
 */

describe('isAppRelativePath', () => {
  it('nimmt Pfade in der App, mit Query und Fragment', () => {
    expect(isAppRelativePath('/deals/42')).toBe(true);
    expect(isAppRelativePath('/all?project=1f0e')).toBe(true);
    expect(isAppRelativePath('/pages/abc#section')).toBe(true);
  });

  it('weist fremde Adressen und Schemata ab', () => {
    for (const url of [
      'https://evil.example/x',
      '//evil.example/x',
      'javascript:alert(1)',
      'deals/42',
      '',
      '/\\evil.example',
      '/deals/ 42',
      '/deals/\n42',
    ]) {
      expect(isAppRelativePath(url), url).toBe(false);
    }
  });

  it('weist Segmente ab, die aus der App herausfuehren, auch kodiert', () => {
    expect(isAppRelativePath('/../crm/deals')).toBe(false);
    expect(isAppRelativePath('/a/%2e%2e/b')).toBe(false);
    expect(isAppRelativePath('/a/./b')).toBe(false);
    expect(isAppRelativePath('/a/%5Cb')).toBe(false);
    expect(isAppRelativePath('/a/%zz')).toBe(false);
  });

  it('weist zu lange Pfade ab', () => {
    expect(isAppRelativePath(`/${'a'.repeat(SEARCH_HIT_LIMITS.url)}`)).toBe(false);
  });
});

describe('normalizeSearchResult', () => {
  it('ist null, wenn die Antwort die Form gar nicht hat', () => {
    expect(normalizeSearchResult(null, 5)).toBeNull();
    expect(normalizeSearchResult([], 5)).toBeNull();
    expect(normalizeSearchResult({ passages: [] }, 5)).toBeNull();
    expect(normalizeSearchResult({ hits: 'x' }, 5)).toBeNull();
  });

  it('laesst unbrauchbare Treffer weg statt die ganze Antwort', () => {
    const hits = normalizeSearchResult(
      {
        hits: [
          { id: 'a', title: 'Deal A', url: '/deals/a', kind: 'Deal', snippet: 'x  «y»\n z' },
          { id: 'b', title: 'Evil', url: 'https://evil.example' },
          { id: '', title: 'Ohne Id', url: '/x' },
          { id: 'c', title: '   ', url: '/x' },
          { id: 'a', title: 'Doppelt', url: '/deals/a' },
          'kein Objekt',
          { id: 7, title: 'Zahl als Id', url: '/x/7' },
        ],
      },
      10,
    );
    expect(hits).toEqual([
      { id: 'a', title: 'Deal A', url: '/deals/a', kind: 'deal', snippet: 'x «y» z' },
      { id: '7', title: 'Zahl als Id', url: '/x/7' },
    ]);
  });

  it('kuerzt lange Felder und schneidet nach maxHits ab', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      id: String(i),
      title: 't'.repeat(500),
      url: `/x/${i}`,
    }));
    const hits = normalizeSearchResult({ hits: many }, 3) ?? [];
    expect(hits).toHaveLength(3);
    expect(hits[0]?.title.length).toBe(SEARCH_HIT_LIMITS.title);
    expect(hits[0]?.title.endsWith('…')).toBe(true);
  });

  it('uebernimmt keine fremden Felder', () => {
    const hits = normalizeSearchResult(
      { hits: [{ id: 'a', title: 'A', url: '/a', rank: 1, secret: 'x' }] },
      5,
    );
    expect(hits).toEqual([{ id: 'a', title: 'A', url: '/a' }]);
  });
});

describe('parseSearchArgs', () => {
  it('trimmt query und setzt den Default fuer limit', () => {
    expect(parseSearchArgs({ query: '  angebot ' })).toEqual({
      query: 'angebot',
      limit: SEARCH_LIMIT_DEFAULT,
    });
    expect(parseSearchArgs({ query: 'x', limit: 20 })).toEqual({ query: 'x', limit: 20 });
  });

  it('weist leere, zu lange und falsch getypte Eingaben mit 400 ab', () => {
    for (const args of [
      null,
      [],
      {},
      { query: '   ' },
      { query: 'x'.repeat(201) },
      { query: 'x', limit: 0 },
      { query: 'x', limit: 21 },
      { query: 'x', limit: 1.5 },
      { query: 'x', apps: ['crm'] },
    ]) {
      expect(() => parseSearchArgs(args), JSON.stringify(args)).toThrow(ToolInputError);
    }
  });
});
