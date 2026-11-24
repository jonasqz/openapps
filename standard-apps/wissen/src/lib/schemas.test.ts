import { describe, expect, it } from 'vitest';
import { DeleteArgs, DocumentInput, GetArgs, ListArgs, SearchArgs } from './schemas';

const UUID = '3f1c2b7e-8d4a-4c1e-9b2f-0a6d5e4c3b21';

describe('SearchArgs', () => {
  it('setzt limit auf 5 und trimmt die Anfrage', () => {
    expect(SearchArgs.parse({ query: '  Reisekosten ' })).toEqual({ query: 'Reisekosten', limit: 5 });
  });

  it('erlaubt limit von 1 bis 20, ganzzahlig', () => {
    expect(SearchArgs.safeParse({ query: 'x', limit: 1 }).success).toBe(true);
    expect(SearchArgs.safeParse({ query: 'x', limit: 20 }).success).toBe(true);
    for (const limit of [0, 21, 2.5, '5', -1, null]) {
      expect(SearchArgs.safeParse({ query: 'x', limit }).success, String(limit)).toBe(false);
    }
  });

  it('weist leere, zu lange und fehlende Anfragen ab', () => {
    for (const input of [{}, { query: '' }, { query: '   ' }, { query: 'x'.repeat(501) }, { query: 3 }]) {
      expect(SearchArgs.safeParse(input).success).toBe(false);
    }
  });

  it('weist unbekannte Felder ab, damit ein Agent seinen Fehler bemerkt', () => {
    expect(SearchArgs.safeParse({ q: 'Reise' }).success).toBe(false);
    expect(SearchArgs.safeParse({ query: 'Reise', top_k: 3 }).success).toBe(false);
  });
});

describe('DocumentInput', () => {
  it('trimmt Titel und Quelle, lässt den Text unverändert', () => {
    expect(
      DocumentInput.parse({ title: ' Handbuch ', content: '  Text\n\n', source: ' v3 ' }),
    ).toEqual({ title: 'Handbuch', content: '  Text\n\n', source: 'v3' });
  });

  it('macht aus fehlender, leerer oder null-Quelle null', () => {
    for (const source of [undefined, null, '', '   ']) {
      expect(DocumentInput.parse({ title: 'T', content: 'C', source }).source).toBeNull();
    }
  });

  it('weist leeren Titel, leeren Text und Überlängen ab', () => {
    const cases = [
      { title: '', content: 'C' },
      { title: '  ', content: 'C' },
      { title: 'T', content: '' },
      { title: 'T', content: ' \n\t ' },
      { title: 'x'.repeat(201), content: 'C' },
      { title: 'T', content: 'x'.repeat(200_001) },
      { title: 'T', content: 'C', source: 'x'.repeat(501) },
    ];
    for (const input of cases) expect(DocumentInput.safeParse(input).success).toBe(false);
    expect(DocumentInput.safeParse({ title: 'x'.repeat(200), content: 'x'.repeat(200_000) }).success).toBe(
      true,
    );
  });

  it('weist unbekannte Felder ab', () => {
    expect(DocumentInput.safeParse({ title: 'T', text: 'C' }).success).toBe(false);
    expect(DocumentInput.safeParse({ title: 'T', content: 'C', createdBy: 'jemand' }).success).toBe(false);
  });
});

describe('ListArgs, GetArgs, DeleteArgs', () => {
  it('ListArgs nimmt nichts oder q', () => {
    expect(ListArgs.parse({})).toEqual({});
    expect(ListArgs.parse({ q: ' Reise ' })).toEqual({ q: 'Reise' });
    expect(ListArgs.safeParse({ query: 'x' }).success).toBe(false);
  });

  it('GetArgs verlangt eine UUID und setzt includeChunks auf false', () => {
    expect(GetArgs.parse({ id: UUID })).toEqual({ id: UUID, includeChunks: false });
    expect(GetArgs.parse({ id: UUID, includeChunks: true }).includeChunks).toBe(true);
    for (const id of ['1', "x' or 1=1 --", '', 42]) {
      expect(GetArgs.safeParse({ id }).success).toBe(false);
    }
  });

  it('DeleteArgs verlangt genau eine UUID', () => {
    expect(DeleteArgs.parse({ id: UUID })).toEqual({ id: UUID });
    expect(DeleteArgs.safeParse({}).success).toBe(false);
    expect(DeleteArgs.safeParse({ id: UUID, hard: true }).success).toBe(false);
  });
});
