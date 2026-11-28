import { describe, expect, it, vi } from 'vitest';
import type { QueryFn } from './db';
import { createHybridRetriever, reciprocalRankFusion, RRF_K } from './hybrid';
import type { EmbedOutcome, PlatformModels } from './platform-models';
import type { Passage, Retriever } from './retriever';
import type { Visibility } from './visibility';

/**
 * Der hybride Retriever ohne Datenbank (ADR 0025 C, D). Riskant zuerst:
 *
 * - Ohne Konfiguration ist das Ergebnis **genau** das des Volltexts, mit
 *   denselben Argumenten, und die Plattform wird nicht gefragt.
 * - Bei unvollstaendiger Abdeckung nur Volltext, ohne Aufruf von `embed`.
 * - Ein Modellwechsel schaltet den Vektor-Teil aus, bis neu berechnet ist.
 * - Die Vektor-Abfrage bekommt dieselbe Sichtbarkeit wie der Volltext, und
 *   die Bedingung steht vor dem Ranking.
 *
 * Gegen Postgres mit pgvector: `test/embeddings.db.test.ts`.
 */

const passage = (chunkId: string, sourceApp: string | null = null): Passage => ({
  chunkId,
  documentId: `d-${chunkId}`,
  documentTitle: `T ${chunkId}`,
  source: null,
  sourceApp,
  sourcePath: null,
  sourceUrl: null,
  ord: 0,
  score: 0.5,
  excerpt: `«${chunkId}»`,
  text: chunkId,
});

const WIKI: Visibility = { readableApps: ['wiki'] };
const KEY = 'openai-compatible/emb/3';

interface FakeDb {
  readonly fn: QueryFn;
  readonly calls: { sql: string; params: readonly unknown[] }[];
}

/** Antwortet je nach Abfrage: Zustand, Abdeckung, Vektor-Liste. */
function fakeDb(options: {
  modelKey: string | null;
  coverage?: { sections: number; embedded: number; withheld: number };
  vectorRows?: Record<string, unknown>[];
}): FakeDb {
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  const fn = (async (sql: string, params: readonly unknown[] = []) => {
    calls.push({ sql, params });
    if (sql.includes('from embedding_state where id')) {
      return [
        {
          model_key: options.modelKey,
          provider: 'openai-compatible',
          model: 'emb',
          dimensions: 3,
          provider_local: false,
          model_since: null,
          checked_at: null,
          last_run_at: null,
          last_error: null,
          last_error_at: null,
          paused_until: null,
          paused_reason: null,
        },
      ];
    }
    if (sql.includes('as sections'))
      return [options.coverage ?? { sections: 0, embedded: 0, withheld: 0 }];
    if (sql.includes('extensions.vector as v')) return options.vectorRows ?? [];
    if (sql.includes('update embedding_state')) return [{ changed: true }];
    return [];
  }) as QueryFn;
  return { fn, calls };
}

function fakeFulltext(result: Passage[]): Retriever & { search: ReturnType<typeof vi.fn> } {
  return { search: vi.fn(async () => result) };
}

function fakeModels(embed: EmbedOutcome): PlatformModels & { embed: ReturnType<typeof vi.fn> } {
  return {
    info: vi.fn(async () => ({ status: 'not_configured' as const })),
    embed: vi.fn(async () => embed),
    generate: vi.fn(async () => ({ status: 'not_configured' as const })),
  };
}

const okEmbed = (dimensions = 3): EmbedOutcome => ({
  status: 'ok',
  model: { provider: 'openai-compatible', model: 'emb', dimensions, local: false },
  embeddings: [{ id: 'query', vector: [0.1, 0.2, 0.3] }],
  withheld: [],
});

describe('ohne Konfiguration: exakt wie 0.2', () => {
  it('gibt das Ergebnis des Volltexts unveraendert zurueck und fragt die Plattform nicht', async () => {
    const db = fakeDb({ modelKey: null });
    const expected = [passage('a'), passage('b')];
    const fulltext = fakeFulltext(expected);
    const models = fakeModels(okEmbed());
    const retriever = createHybridRetriever({ query: db.fn, fulltext, models: () => models });

    const result = await retriever.search('Reisekosten', 5, WIKI);

    expect(result).toBe(expected);
    expect(fulltext.search).toHaveBeenCalledTimes(1);
    expect(fulltext.search).toHaveBeenCalledWith('Reisekosten', 5, WIKI);
    expect(models.embed).not.toHaveBeenCalled();
    expect(models.info).not.toHaveBeenCalled();
    expect(retriever.lastSkip()).toBe('no_model');
  });
});

describe('Abdeckung und Modellwechsel', () => {
  it('unvollstaendige Abdeckung: nur Volltext, kein Vektor fuer die Anfrage', async () => {
    const db = fakeDb({ modelKey: KEY, coverage: { sections: 10, embedded: 9, withheld: 0 } });
    const fulltext = fakeFulltext([passage('a')]);
    const models = fakeModels(okEmbed());
    const retriever = createHybridRetriever({ query: db.fn, fulltext, models: () => models });

    await retriever.search('x', 5, WIKI);
    expect(models.embed).not.toHaveBeenCalled();
    expect(fulltext.search).toHaveBeenCalledWith('x', 5, WIKI);
    expect(retriever.lastSkip()).toBe('incomplete');
    // Die Abdeckung wird mit der Sichtbarkeit des Aufrufers gezaehlt.
    const coverageCall = db.calls.find((call) => call.sql.includes('as sections'));
    expect(coverageCall?.params).toEqual([KEY, false, ['wiki']]);
  });

  it('zurueckgehaltene Abschnitte zaehlen nicht gegen die Abdeckung', async () => {
    const db = fakeDb({ modelKey: KEY, coverage: { sections: 10, embedded: 8, withheld: 2 } });
    const fulltext = fakeFulltext([passage('a')]);
    const models = fakeModels(okEmbed());
    const retriever = createHybridRetriever({ query: db.fn, fulltext, models: () => models });
    await retriever.search('x', 5, WIKI);
    expect(models.embed).toHaveBeenCalledTimes(1);
  });

  it('nur zurueckgehaltene Abschnitte: kein Vektor-Teil, weil es keinen Vektor gibt', async () => {
    const db = fakeDb({ modelKey: KEY, coverage: { sections: 2, embedded: 0, withheld: 2 } });
    const models = fakeModels(okEmbed());
    const retriever = createHybridRetriever({
      query: db.fn,
      fulltext: fakeFulltext([]),
      models: () => models,
    });
    await retriever.search('x', 5, WIKI);
    expect(models.embed).not.toHaveBeenCalled();
  });

  it('ein Modellwechsel schaltet auf Volltext und merkt sich die neue Kennung', async () => {
    const db = fakeDb({ modelKey: KEY, coverage: { sections: 3, embedded: 3, withheld: 0 } });
    const fulltext = fakeFulltext([passage('a')]);
    const models = fakeModels(okEmbed(1536));
    const retriever = createHybridRetriever({ query: db.fn, fulltext, models: () => models });

    const result = await retriever.search('x', 5, WIKI);
    expect(result).toEqual([passage('a')]);
    expect(retriever.lastSkip()).toBe('model_changed');
    const update = db.calls.find((call) => call.sql.includes('update embedding_state'));
    expect(update?.params[0]).toBe('openai-compatible/emb/1536');
    expect(db.calls.some((call) => call.sql.includes('extensions.vector as v'))).toBe(false);
  });

  it('Anbieter weg, Tagesgrenze, keine Freigabe: die Suche antwortet trotzdem mit Volltext', async () => {
    for (const status of ['error', 'budget_exceeded', 'denied', 'no_platform'] as const) {
      const db = fakeDb({ modelKey: KEY, coverage: { sections: 1, embedded: 1, withheld: 0 } });
      const fulltext = fakeFulltext([passage('a')]);
      const models = fakeModels({ status });
      const retriever = createHybridRetriever({ query: db.fn, fulltext, models: () => models });
      expect(await retriever.search('x', 5, WIKI), status).toEqual([passage('a')]);
      expect(retriever.lastSkip()).toBe('query_not_embedded');
    }
  });
});

describe('hybrid: dieselbe Sichtbarkeit in beiden Listen', () => {
  it('fragt die Vektor-Liste mit denselben lesbaren Apps und fuehrt per RRF zusammen', async () => {
    const vectorRows = [
      {
        chunk_id: 'v1',
        document_id: 'd-v1',
        title: 'Vektor',
        source: null,
        source_app: 'wiki',
        source_path: '/pages/1',
        ord: 2,
        distance: 0.1,
        excerpt: 'Anfang',
        text: 'Anfang des Abschnitts',
      },
      {
        chunk_id: 'a',
        document_id: 'd-a',
        title: 'T a',
        source: null,
        source_app: null,
        source_path: null,
        ord: 0,
        distance: 0.2,
        excerpt: 'a',
        text: 'a',
      },
    ];
    const db = fakeDb({
      modelKey: KEY,
      coverage: { sections: 2, embedded: 2, withheld: 0 },
      vectorRows,
    });
    const fulltext = fakeFulltext([passage('a'), passage('b')]);
    const models = fakeModels(okEmbed());
    const retriever = createHybridRetriever({ query: db.fn, fulltext, models: () => models });

    const result = await retriever.search('Reise', 5, WIKI);

    // Die Anfrage geht als Inhalt von Knowledge hinaus, mit ihrer Quell-App.
    expect(models.embed).toHaveBeenCalledWith(
      [{ id: 'query', sourceApp: 'knowledge', text: 'Reise' }],
      {
        timeoutMs: 3000,
      },
    );
    expect(fulltext.search).toHaveBeenCalledWith('Reise', 20, WIKI);
    const vectorCall = db.calls.find((call) => call.sql.includes('extensions.vector as v'));
    expect(vectorCall?.params[1]).toBe(KEY);
    expect(vectorCall?.params[2]).toEqual(['wiki']);
    expect(result.map((p) => p.chunkId)).toEqual(['a', 'v1', 'b']);
    expect(result[0]?.excerpt).toBe('«a»');
    expect(retriever.lastSkip()).toBeNull();
  });

  it('die Bedingung der Sichtbarkeit steht in der Vektor-Abfrage vor order by und limit', async () => {
    const db = fakeDb({ modelKey: KEY, coverage: { sections: 1, embedded: 1, withheld: 0 } });
    const models = fakeModels(okEmbed());
    const retriever = createHybridRetriever({
      query: db.fn,
      fulltext: fakeFulltext([]),
      models: () => models,
    });
    await retriever.search('x', 5, { readableApps: null });
    const vectorCall = db.calls.find((call) => call.sql.includes('extensions.vector as v'));
    const sql = vectorCall?.sql ?? '';
    const where = sql.indexOf('d.source_app = any($3::text[])');
    expect(where).toBeGreaterThan(sql.indexOf(' where '));
    expect(where).toBeLessThan(sql.indexOf('order by distance'));
    expect(sql.indexOf('order by distance')).toBeLessThan(sql.indexOf('limit $4'));
    expect(sql).toContain('d.deleted_at is null');
    expect(sql).toContain('OPERATOR(extensions.<=>)');
    // Ohne gueltige Liste: nur eigene Dokumente, wie im Volltext.
    expect(vectorCall?.params[2]).toEqual([]);
  });

  it('scheitert die Vektor-Abfrage, antwortet die Suche mit Volltext und meldet es einmal', async () => {
    const warn = vi.fn();
    const base = fakeDb({ modelKey: KEY, coverage: { sections: 1, embedded: 1, withheld: 0 } });
    const failing = (async (sql: string, params?: readonly unknown[]) => {
      if (sql.includes('extensions.vector as v'))
        throw new Error('different vector dimensions 3 and 4');
      return base.fn(sql, params);
    }) as QueryFn;
    const fulltext = fakeFulltext([passage('a')]);
    const retriever = createHybridRetriever({
      query: failing,
      fulltext,
      models: () => fakeModels(okEmbed()),
      warn,
    });
    expect(await retriever.search('x', 5, WIKI)).toEqual([passage('a')]);
    expect(await retriever.search('x', 5, WIKI)).toEqual([passage('a')]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(retriever.lastSkip()).toBe('failed');
  });
});

describe('reciprocalRankFusion', () => {
  it('summiert 1/(k+rang) je Liste, ein Treffer in beiden steht vorn', () => {
    const fused = reciprocalRankFusion(
      [passage('a'), passage('b')],
      [passage('b'), passage('c')],
      10,
    );
    expect(fused.map((p) => p.chunkId)).toEqual(['b', 'a', 'c']);
    expect(fused[0]?.score).toBeCloseTo(1 / (RRF_K + 2) + 1 / (RRF_K + 1), 6);
  });

  it('nimmt bei Dubletten die Fassung aus der ersten Liste und kuerzt auf limit', () => {
    const fromVector = { ...passage('a'), excerpt: 'ohne Markierung' };
    const fused = reciprocalRankFusion([passage('a')], [fromVector, passage('z')], 1);
    expect(fused).toHaveLength(1);
    expect(fused[0]?.excerpt).toBe('«a»');
  });

  it('Gleichstand: Reihenfolge der ersten Liste vor der zweiten', () => {
    const fused = reciprocalRankFusion([passage('a')], [passage('b')], 5);
    expect(fused.map((p) => p.chunkId)).toEqual(['a', 'b']);
  });
});
