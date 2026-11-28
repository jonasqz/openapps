import { describe, expect, it, vi } from 'vitest';
import type { QueryFn } from './db';
import {
  BACKFILL_DAILY_SHARE,
  backfillAllowance,
  EMBED_BATCH,
  estimateTokens,
  nextUtcDay,
  runEmbeddingCycle,
  vectorLiteral,
} from './embeddings';
import type {
  EmbedOutcome,
  EmbeddingModelInfo,
  ModelBudget,
  ModelInfo,
  PlatformModels,
  SourcedText,
} from './platform-models';

/**
 * Die Warteschlange der Embeddings mit gestelltem Modell und einer kleinen
 * Datenbank im Speicher (ADR 0025 B, D). Riskant zuerst:
 *
 * - Ohne Konfiguration wird `embed` nie gerufen, und nichts ist ein Fehler.
 * - Jeder Text geht mit seiner Quell-App hinaus; was die Plattform
 *   zurueckhaelt, bekommt keinen Vektor, zaehlt aber als erledigt.
 * - Der Backfill nimmt hoechstens seinen Tagesanteil und pausiert dann bis
 *   zum naechsten UTC-Tag; die Grenze selbst aendert er nie.
 * - Ein Modellwechsel macht alles wieder ausstehend; alte Vektoren gehen
 *   erst, wenn die neue Kennung alles abdeckt.
 *
 * Gegen Postgres mit pgvector: `test/embeddings.db.test.ts`.
 */

interface Chunk {
  id: string;
  text: string;
  sourceApp: string | null;
}

interface Store {
  chunks: Chunk[];
  /** `<chunk>|<kennung>` → zurueckgehalten? */
  embeddings: Map<string, { withheld: boolean; vector: string | null }>;
  state: {
    model_key: string | null;
    paused_until: Date | null;
    paused_reason: string | null;
    last_error: string | null;
  };
}

function memoryDb(chunks: Chunk[]): { store: Store; query: QueryFn } {
  const store: Store = {
    chunks,
    embeddings: new Map(),
    state: { model_key: null, paused_until: null, paused_reason: null, last_error: null },
  };
  const has = (id: string, key: string): boolean => store.embeddings.has(`${id}|${key}`);
  const query = (async (sql: string, params: readonly unknown[] = []) => {
    const p = params as unknown[];
    if (sql.includes('from embedding_state where id')) {
      return [
        {
          ...store.state,
          provider: null,
          model: null,
          dimensions: null,
          provider_local: null,
          model_since: null,
          checked_at: null,
          last_run_at: null,
          last_error_at: null,
        },
      ];
    }
    if (sql.includes('set model_key = $1')) {
      const changed = store.state.model_key !== p[0];
      if (changed) {
        store.state.model_key = p[0] as string | null;
        store.state.paused_until = null;
        store.state.paused_reason = null;
      }
      return [{ changed: changed && p[0] !== null }];
    }
    if (sql.includes('set last_error = $1')) {
      store.state.last_error = p[0] as string;
      store.state.paused_until = p[1] === null ? null : new Date(p[1] as string);
      store.state.paused_reason = p[1] === null ? null : (p[0] as string);
      return [];
    }
    if (sql.includes('set paused_until = $2::timestamptz, paused_reason = $1')) {
      store.state.paused_reason = p[0] as string;
      store.state.paused_until = new Date(p[1] as string);
      return [];
    }
    if (sql.includes('set last_run_at')) return [];
    if (sql.includes('pg_try_advisory_xact_lock')) return [{ ok: true }];
    if (sql.includes('as sections')) {
      const key = p[0] as string;
      let embedded = 0;
      let withheld = 0;
      for (const chunk of store.chunks) {
        const entry = store.embeddings.get(`${chunk.id}|${key}`);
        if (entry === undefined) continue;
        if (entry.withheld) withheld += 1;
        else embedded += 1;
      }
      return [{ sections: store.chunks.length, embedded, withheld }];
    }
    if (sql.includes('delete from chunk_embeddings where model_key <> $1')) {
      let n = 0;
      for (const id of [...store.embeddings.keys()]) {
        if (!id.endsWith(`|${String(p[0])}`)) {
          store.embeddings.delete(id);
          n += 1;
        }
      }
      return [{ n }];
    }
    if (sql.includes('select c.id::text as id, c.text, d.source_app')) {
      const key = p[0] as string;
      return store.chunks
        .filter((chunk) => !has(chunk.id, key))
        .slice(0, p[1] as number)
        .map((chunk) => ({ id: chunk.id, text: chunk.text, source_app: chunk.sourceApp }));
    }
    if (sql.includes('u.v::extensions.vector, false')) {
      const [key, ids, vectors] = p as [string, string[], string[]];
      ids.forEach((id, index) => {
        store.embeddings.set(`${id}|${key}`, { withheld: false, vector: vectors[index] ?? null });
      });
      return [];
    }
    if (sql.includes('$1, null, true')) {
      const [key, ids] = p as [string, string[]];
      for (const id of ids) store.embeddings.set(`${id}|${key}`, { withheld: true, vector: null });
      return [];
    }
    throw new Error(`unexpected SQL in test: ${sql.slice(0, 80)}`);
  }) as QueryFn;
  return { store, query };
}

const MODEL: EmbeddingModelInfo = {
  provider: 'gemini',
  model: 'text-embedding',
  dimensions: 3,
  local: false,
};
const KEY = 'gemini/text-embedding/3';

const BUDGET: ModelBudget = {
  resetsAt: '2026-11-29T00:00:00.000Z',
  subject: { limit: 200_000, used: 0 },
  installation: { limit: 1_000_000, used: 0 },
};

function fakeModels(options: {
  info?: ModelInfo;
  /** Apps, die die gestellte Plattform zurueckhaelt (externer Anbieter). */
  localOnly?: readonly string[];
  embed?: (texts: readonly SourcedText[]) => EmbedOutcome;
  model?: EmbeddingModelInfo;
}): PlatformModels & { sent: SourcedText[][] } {
  const sent: SourcedText[][] = [];
  const model = options.model ?? MODEL;
  return {
    sent,
    info: vi.fn(
      async () =>
        options.info ?? { status: 'ok' as const, chat: null, embedding: model, budget: BUDGET },
    ),
    embed: vi.fn(async (texts: readonly SourcedText[]) => {
      if (options.embed !== undefined) return options.embed(texts);
      const kept = texts.filter((t) => !(options.localOnly ?? []).includes(t.sourceApp));
      sent.push(kept);
      return {
        status: 'ok' as const,
        model,
        embeddings: kept.map((t) => ({ id: t.id, vector: [t.text.length, 1, 0] })),
        withheld: texts.filter((t) => !kept.includes(t)).map((t) => t.id),
      };
    }),
    generate: vi.fn(async () => ({ status: 'not_configured' as const })),
  };
}

const chunk = (id: string, sourceApp: string | null = null, text = `Section ${id}`): Chunk => ({
  id,
  text,
  sourceApp,
});

const run = (db: ReturnType<typeof memoryDb>, models: PlatformModels) =>
  runEmbeddingCycle(
    {
      query: db.query,
      withTransaction: (work) => work(db.query),
      models,
      now: () => new Date('2026-11-28T10:00:00Z'),
    },
    { budgetMs: 60_000 },
  );

describe('ohne Konfiguration', () => {
  it('ruft embed nie und haelt nichts fuer einen Fehler', async () => {
    const db = memoryDb([chunk('a'), chunk('b')]);
    const models = fakeModels({
      info: { status: 'ok', chat: null, embedding: null, budget: null },
    });
    const report = await run(db, models);
    expect(models.embed).not.toHaveBeenCalled();
    expect(report).toMatchObject({ embedded: 0, stopped: 'no embedding model is configured' });
    expect(db.store.state.model_key).toBeNull();
    expect(db.store.state.last_error).toBeNull();
    expect(db.store.embeddings.size).toBe(0);
  });

  it('ohne Plattform (Env fehlt): kein Aufruf, die Suche bleibt Volltext', async () => {
    const db = memoryDb([chunk('a')]);
    const models = fakeModels({ info: { status: 'no_platform' } });
    await run(db, models);
    expect(models.embed).not.toHaveBeenCalled();
    expect(db.store.state.model_key).toBeNull();
  });
});

describe('Local-only-Apps (ADR 0024 C2)', () => {
  it('jeder Text geht mit Quell-App hinaus; Zurueckgehaltenes hat keinen Vektor, zaehlt aber als erledigt', async () => {
    const db = memoryDb([chunk('own'), chunk('w1', 'wiki'), chunk('c1', 'crm')]);
    const models = fakeModels({ localOnly: ['crm'] });
    const report = await run(db, models);

    const asked = (models.embed as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as SourcedText[];
    expect(asked.map((t) => [t.id, t.sourceApp])).toEqual([
      ['own', 'knowledge'],
      ['w1', 'wiki'],
      ['c1', 'crm'],
    ]);
    // Bei der gestellten Plattform kam der CRM-Text nicht beim Anbieter an.
    expect(models.sent.flat().map((t) => t.id)).toEqual(['own', 'w1']);
    expect(db.store.embeddings.get(`c1|${KEY}`)).toEqual({ withheld: true, vector: null });
    expect(db.store.embeddings.get(`w1|${KEY}`)?.vector).toBe('[10,1,0]');
    expect(report).toMatchObject({ embedded: 2, withheld: 1, pending: 0 });
  });
});

describe('Anbieter weg oder Grenze erreicht', () => {
  it('Fehler des Anbieters: nichts gespeichert, Pause, kein Absturz', async () => {
    const db = memoryDb([chunk('a')]);
    const models = fakeModels({ embed: () => ({ status: 'error' }) });
    const report = await run(db, models);
    expect(report.stopped).toBe('the platform or the model provider did not answer');
    expect(db.store.embeddings.size).toBe(0);
    expect(db.store.state.paused_until?.toISOString()).toBe('2026-11-28T10:05:00.000Z');
  });

  it('Tagesgrenze der Plattform (429): Pause bis zum naechsten UTC-Tag', async () => {
    const db = memoryDb([chunk('a')]);
    const models = fakeModels({ embed: () => ({ status: 'budget_exceeded' }) });
    await run(db, models);
    expect(db.store.state.paused_until?.toISOString()).toBe(BUDGET.resetsAt);
  });

  it('waehrend einer Pause wird nicht eingebettet', async () => {
    const db = memoryDb([chunk('a')]);
    db.store.state.model_key = KEY;
    db.store.state.paused_until = new Date('2026-11-29T00:00:00Z');
    db.store.state.paused_reason = 'the daily share for embedding is used up';
    const models = fakeModels({});
    const report = await run(db, models);
    expect(models.embed).not.toHaveBeenCalled();
    expect(report.stopped).toMatch(/^paused until/);
  });
});

describe('Budget: der Backfill nimmt nur seinen Tagesanteil', () => {
  it('hoert am Anteil auf, pausiert bis zum naechsten Tag und hebt die Grenze nicht an', async () => {
    // Jeder Abschnitt kostet 250 Tokens; vom Anteil (100 000) sind 99 600 schon weg.
    const text = 'x'.repeat(1000);
    const db = memoryDb([chunk('a', null, text), chunk('b', null, text), chunk('c', null, text)]);
    const models = fakeModels({
      info: {
        status: 'ok',
        chat: null,
        embedding: MODEL,
        budget: { ...BUDGET, subject: { limit: 200_000, used: 99_600 } },
      },
    });
    const report = await run(db, models);
    expect(report).toMatchObject({ embedded: 1, stopped: 'daily share used up', pending: 2 });
    expect(db.store.state.paused_until?.toISOString()).toBe(BUDGET.resetsAt);
    expect(db.store.state.paused_reason).toBe('the daily share for embedding is used up');
  });

  it('der Anteil gilt auch fuer die Grenze der Installation', () => {
    expect(
      backfillAllowance({
        resetsAt: BUDGET.resetsAt,
        subject: { limit: 200_000, used: 0 },
        installation: { limit: 1_000_000, used: 499_000 },
      }),
    ).toBe(1_000);
    expect(backfillAllowance({ ...BUDGET, subject: { limit: 200_000, used: 150_000 } })).toBe(0);
    expect(BACKFILL_DAILY_SHARE).toBe(0.5);
  });

  it('bettet in Stapeln ein, nie mehr als die Plattform je Aufruf annimmt', async () => {
    const db = memoryDb(Array.from({ length: EMBED_BATCH + 5 }, (_, i) => chunk(`c${String(i)}`)));
    const models = fakeModels({});
    const report = await run(db, models);
    const calls = (models.embed as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.map((call) => (call[0] as SourcedText[]).length)).toEqual([EMBED_BATCH, 5]);
    expect(report).toMatchObject({ embedded: EMBED_BATCH + 5, pending: 0 });
  });
});

describe('Modellwechsel (ADR 0025 D)', () => {
  it('neue Kennung: alles wieder ausstehend, alte Vektoren erst nach Abschluss geloescht', async () => {
    const db = memoryDb([chunk('a'), chunk('b')]);
    await run(db, fakeModels({}));
    expect([...db.store.embeddings.keys()].sort()).toEqual([`a|${KEY}`, `b|${KEY}`]);

    const other: EmbeddingModelInfo = { ...MODEL, model: 'text-embedding-2', dimensions: 4 };
    // Der neue Anbieter faellt nach dem ersten Stapel aus: alte Vektoren bleiben.
    let calls = 0;
    const flaky = fakeModels({
      model: other,
      embed: (texts) => {
        calls += 1;
        if (calls > 1) return { status: 'error' };
        return {
          status: 'ok',
          model: other,
          embeddings: texts.slice(0, 1).map((t) => ({ id: t.id, vector: [1, 2, 3, 4] })),
          withheld: [],
        };
      },
    });
    const partial = await run(db, flaky);
    expect(db.store.state.model_key).toBe('gemini/text-embedding-2/4');
    expect(partial.pending).toBe(1);
    expect(db.store.embeddings.has(`a|${KEY}`)).toBe(true);

    db.store.state.paused_until = null;
    const done = await run(db, fakeModels({ model: other }));
    expect(done).toMatchObject({ pending: 0, removedOld: 2 });
    expect(
      [...db.store.embeddings.keys()].every((k) => k.endsWith('|gemini/text-embedding-2/4')),
    ).toBe(true);
  });

  it('meldet embed ein anderes Modell als model_info, wird nichts gespeichert', async () => {
    const db = memoryDb([chunk('a')]);
    const other: EmbeddingModelInfo = { ...MODEL, model: 'surprise' };
    const models = fakeModels({
      embed: (texts) => ({
        status: 'ok',
        model: other,
        embeddings: texts.map((t) => ({ id: t.id, vector: [1, 1, 1] })),
        withheld: [],
      }),
    });
    const report = await run(db, models);
    expect(report.stopped).toBe('the embedding model changed');
    expect(db.store.embeddings.size).toBe(0);
    expect(db.store.state.model_key).toBe('gemini/surprise/3');
  });
});

describe('Bausteine', () => {
  it('vectorLiteral nimmt nur endliche Zahlen', () => {
    expect(vectorLiteral([0.5, -1, 2e-3])).toBe('[0.5,-1,0.002]');
    expect(() => vectorLiteral([1, Number.NaN])).toThrow();
    expect(() => vectorLiteral([Number.POSITIVE_INFINITY])).toThrow();
  });

  it('nextUtcDay und estimateTokens', () => {
    expect(nextUtcDay(new Date('2026-11-28T23:59:59Z')).toISOString()).toBe(
      '2026-11-29T00:00:00.000Z',
    );
    expect(estimateTokens('abcde')).toBe(2);
  });
});
