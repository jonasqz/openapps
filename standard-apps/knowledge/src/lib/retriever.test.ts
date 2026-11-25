import { describe, expect, it } from 'vitest';
import type { QueryFn } from './db';
import { createFulltextRetriever, mergePassages, orQueryText, type Passage } from './retriever';

const passage = (chunkId: string): Passage => ({
  chunkId,
  documentId: 'd',
  documentTitle: 'T',
  source: null,
  ord: 0,
  score: 0.1,
  excerpt: 'e',
  text: 't',
});

const row = (chunkId: string) => ({
  chunk_id: chunkId,
  document_id: 'd',
  title: 'T',
  source: null,
  ord: 0,
  score: 0.123456,
  excerpt: '«e»',
  text: 't',
});

/** Ein QueryFn, der die Aufrufe mitschreibt und je Aufruf vorgegebene Zeilen liefert. */
function fakeQuery(results: Record<string, unknown>[][]) {
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  const fn = (async (sql: string, params: readonly unknown[] = []) => {
    calls.push({ sql, params });
    return results[calls.length - 1] ?? [];
  }) as QueryFn;
  return { fn, calls };
}

describe('orQueryText', () => {
  it('verbindet die Wörter mit ODER und sucht lange Wörter auch als Wortanfang', () => {
    expect(orQueryText('Reise Hotel ab')).toBe('reise:* | hotel:* | ab');
  });

  it('lässt nur Buchstaben und Ziffern durch, keine tsquery-Operatoren', () => {
    expect(orQueryText("Reise & !Hotel | (x) <-> 'y':* \\z")).toBe('reise:* | hotel:* | x | y | z');
    expect(orQueryText('& | ! ( ) : *')).toBeNull();
  });

  it('lässt ausgeschlossene Wörter und den Operator or weg', () => {
    expect(orQueryText('Reise -Ausland or Hotel OR')).toBe('reise:* | hotel:*');
  });

  it('behält Umlaute und ß und entfernt Dubletten', () => {
    expect(orQueryText('Übernachtung übernachtung Größe')).toBe('übernachtung:* | größe:*');
  });

  it('nimmt Wörter aus Phrasen in Anführungszeichen', () => {
    expect(orQueryText('"Freigabe ab Betrag"')).toBe('freigabe:* | ab | betrag:*');
  });

  it('begrenzt die Zahl der Wörter', () => {
    const query = Array.from({ length: 100 }, (_, i) => `w${i}`).join(' ');
    expect(orQueryText(query)?.split(' | ')).toHaveLength(32);
  });

  it('gibt null für leere Anfragen', () => {
    expect(orQueryText('')).toBeNull();
    expect(orQueryText('   ')).toBeNull();
  });
});

describe('mergePassages', () => {
  it('stellt die erste Liste vorn, entfernt Dubletten und kürzt auf limit', () => {
    const merged = mergePassages([passage('a'), passage('b')], [passage('b'), passage('c'), passage('d')], 3);
    expect(merged.map((p) => p.chunkId)).toEqual(['a', 'b', 'c']);
  });
});

describe('createFulltextRetriever', () => {
  it('fragt nur streng, wenn die strenge Anfrage genug liefert', async () => {
    const { fn, calls } = fakeQuery([[row('a'), row('b')]]);
    const passages = await createFulltextRetriever(fn).search('Reise Hotel', 2);
    expect(passages.map((p) => p.chunkId)).toEqual(['a', 'b']);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain("websearch_to_tsquery('english', $1)");
    expect(calls[0]?.params[0]).toBe('Reise Hotel');
  });

  it('ergänzt mit der ODER-Anfrage, schließt schon gefundene Abschnitte aus und entfernt Dubletten', async () => {
    const { fn, calls } = fakeQuery([[row('a')], [row('a'), row('b'), row('c')]]);
    const passages = await createFulltextRetriever(fn).search('Reise Hotel', 3);
    expect(passages.map((p) => p.chunkId)).toEqual(['a', 'b', 'c']);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.sql).toContain("to_tsquery('english', $1)");
    expect(calls[1]?.params[0]).toBe('reise:* | hotel:*');
    expect(calls[1]?.params[1]).toBe(2);
    expect(calls[1]?.params[3]).toEqual(['a']);
  });

  it('übergibt die Anfrage nur als Parameter, nie im SQL-Text', async () => {
    const evil = "x'); drop table documents; --";
    const { fn, calls } = fakeQuery([[], []]);
    await createFulltextRetriever(fn).search(evil, 5);
    for (const call of calls) expect(call.sql).not.toContain('drop table');
  });

  it('sucht nur in nicht gelöschten Dokumenten und markiert mit «»', async () => {
    const { fn, calls } = fakeQuery([[], []]);
    await createFulltextRetriever(fn).search('Reise', 5);
    for (const call of calls) {
      expect(call.sql).toContain('d.deleted_at is null');
      expect(call.sql).toContain('ts_rank_cd');
      expect(call.sql).toContain('ts_headline');
      expect(String(call.params[2])).toContain('StartSel="«"');
      expect(String(call.params[2])).toContain('StopSel="»"');
    }
  });

  it('liefert die Felder der Passage und rundet den Rang', async () => {
    const { fn } = fakeQuery([[row('a')]]);
    const [first] = await createFulltextRetriever(fn).search('Reise', 1);
    expect(first).toEqual({
      chunkId: 'a',
      documentId: 'd',
      documentTitle: 'T',
      source: null,
      ord: 0,
      score: 0.1235,
      excerpt: '«e»',
      text: 't',
    });
  });
});
