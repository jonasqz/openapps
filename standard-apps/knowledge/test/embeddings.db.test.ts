import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@openapps/sdk';
import { appPool, query, withTransaction } from '@/lib/db';
import { addDocument, upsertSourceDocument } from '@/lib/documents';
import { coverage, runEmbeddingCycle } from '@/lib/embeddings';
import { createHybridRetriever, vectorSearch } from '@/lib/hybrid';
import type {
  EmbedOutcome,
  EmbeddingModelInfo,
  PlatformModels,
  SourcedText,
} from '@/lib/platform-models';
import { createFulltextRetriever } from '@/lib/retriever';
import { DocumentInput, UpsertArgs } from '@/lib/schemas';
import { OWN_DOCUMENTS_ONLY, type Visibility } from '@/lib/visibility';

/**
 * Die hybride Suche gegen Postgres mit pgvector (ADR 0025), mit gestelltem
 * Modell: Vektoren aus einem Wortbeutel, kein Anbieter. Laeuft nur mit
 * `KNOWLEDGE_TEST_DATABASE_URL` und `KNOWLEDGE_TEST_DATABASE_SCHEMA`, sonst
 * uebersprungen (wie `documents.db.test.ts`).
 *
 * Voraussetzung wie im Betrieb: pgvector im Schema `extensions`
 * (`infra/betrieb/postgres/vector.sql` als Superuser) und fuer die App-Rolle
 * nur `USAGE` darauf, kein `CREATE`:
 *
 *   GRANT USAGE ON SCHEMA extensions TO app_knowledge;
 *
 * Riskant zuerst: ein nicht lesbares Dokument erscheint weder ueber Volltext
 * noch ueber Vektor; ohne Konfiguration dieselben Treffer wie 0.2; bei
 * unvollstaendiger Abdeckung nur Volltext; Modellwechsel; die Rolle hat auf
 * `extensions` nur USAGE.
 */
const url = process.env.KNOWLEDGE_TEST_DATABASE_URL ?? '';
const schema = process.env.KNOWLEDGE_TEST_DATABASE_SCHEMA ?? '';
const enabled = url !== '' && schema !== '';

const MIGRATIONS = fileURLToPath(new URL('../migrations', import.meta.url));
const WIKI_ONLY: Visibility = { readableApps: ['wiki'] };

const DIMS = 16;

/** Ein Wortbeutel als Vektor: gleiche Woerter, kleiner Abstand. */
function bagOfWords(text: string): number[] {
  const vector = new Array<number>(DIMS).fill(0);
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    let hash = 0;
    for (const char of word) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    vector[hash % DIMS] = (vector[hash % DIMS] ?? 0) + 1;
  }
  if (!vector.some((value) => value !== 0)) vector[0] = 1;
  return vector;
}

function fakeModels(options: {
  model: EmbeddingModelInfo;
  localOnly?: readonly string[];
  fail?: boolean;
}): PlatformModels & { sent: SourcedText[] } {
  const sent: SourcedText[] = [];
  return {
    sent,
    async info() {
      return {
        status: 'ok',
        chat: null,
        embedding: options.model,
        budget: {
          resetsAt: new Date(Date.now() + 86_400_000).toISOString(),
          subject: { limit: 200_000, used: 0 },
          installation: { limit: 1_000_000, used: 0 },
        },
      };
    },
    async embed(texts): Promise<EmbedOutcome> {
      if (options.fail === true) return { status: 'error' };
      const kept = texts.filter((t) => !(options.localOnly ?? []).includes(t.sourceApp));
      sent.push(...kept);
      return {
        status: 'ok',
        model: options.model,
        embeddings: kept.map((t) => ({ id: t.id, vector: bagOfWords(t.text) })),
        withheld: texts.filter((t) => !kept.includes(t)).map((t) => t.id),
      };
    },
    async generate() {
      return { status: 'not_configured' };
    },
  };
}

const MODEL_A: EmbeddingModelInfo = {
  provider: 'openai-compatible',
  model: 'bag-a',
  dimensions: DIMS,
  local: true,
};
const MODEL_B: EmbeddingModelInfo = { ...MODEL_A, model: 'bag-b' };

const fulltext = createFulltextRetriever(query);

function hybrid(models: PlatformModels) {
  return createHybridRetriever({ query, fulltext, models: () => models });
}

const cycle = (models: PlatformModels) =>
  runEmbeddingCycle({ query, withTransaction, models }, { budgetMs: 30_000 });

const upsert = (input: unknown, app = 'wiki') =>
  upsertSourceDocument(UpsertArgs.parse(input), app, `app:${app}`);

describe.skipIf(!enabled)('Knowledge mit pgvector', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.DATABASE_SCHEMA = schema;
    process.env.OPENAPPS_APP_HOST = 'apps.example.test';
    await runMigrations(appPool(), MIGRATIONS);
  });

  beforeEach(async () => {
    await query('delete from documents');
    await query('delete from chunk_embeddings');
    await query(
      `update embedding_state set model_key = null, provider = null, model = null,
              dimensions = null, provider_local = null, paused_until = null,
              paused_reason = null, last_error = null where id`,
    );
  });

  afterAll(async () => {
    await appPool().end();
  });

  it('die Rolle von Knowledge hat auf extensions nur USAGE, kein CREATE', async () => {
    const rows = await query<{ usage: boolean; create: boolean }>(
      `select has_schema_privilege(current_user, 'extensions', 'USAGE') as usage,
              has_schema_privilege(current_user, 'extensions', 'CREATE') as create`,
    );
    expect(rows[0]).toEqual({ usage: true, create: false });
    await expect(query('create table extensions.boese (id int)')).rejects.toThrow(
      /permission denied/,
    );
    // Der search_path bleibt das eigene Schema.
    const path = await query<{ search_path: string }>('show search_path');
    expect(path[0]?.search_path).not.toContain('extensions');
  });

  it('ohne Konfiguration: dieselben Treffer wie der Volltext aus 0.2', async () => {
    await addDocument(
      DocumentInput.parse({ title: 'Reise', content: 'Die Reisekosten werden erstattet.' }),
      'usr_test',
    );
    await upsert({ key: 'p1', title: 'Onboarding', content: 'Onboarding im Wiki' });
    const unconfigured: PlatformModels = {
      info: async () => ({ status: 'ok', chat: null, embedding: null, budget: null }),
      embed: async () => {
        throw new Error('embed must not be called without configuration');
      },
      generate: async () => ({ status: 'not_configured' }),
    };
    await cycle(unconfigured);
    const retriever = hybrid(unconfigured);
    for (const [text, visibility] of [
      ['Reisekosten erstatten', OWN_DOCUMENTS_ONLY],
      ['Onboarding', WIKI_ONLY],
      ['Onboarding Raumschiff', OWN_DOCUMENTS_ONLY],
    ] as const) {
      expect(await retriever.search(text, 5, visibility)).toEqual(
        await fulltext.search(text, 5, visibility),
      );
    }
    expect(await query('select 1 from chunk_embeddings')).toEqual([]);
  });

  it('ein nicht lesbares Dokument erscheint weder ueber Volltext noch ueber Vektor', async () => {
    await addDocument(
      DocumentInput.parse({ title: 'Eigenes', content: 'Kantine Speiseplan Montag' }),
      'usr_test',
    );
    // Das Wiki-Dokument ist dem Vektor der Anfrage am naechsten.
    await upsert({ key: 'geheim', title: 'Geheim', content: 'Onboarding Gehalt Bonus' });
    const models = fakeModels({ model: MODEL_A });
    const report = await cycle(models);
    expect(report.pending).toBe(0);

    const retriever = hybrid(models);
    const own = await retriever.search('Onboarding Gehalt Bonus', 5, OWN_DOCUMENTS_ONLY);
    expect(retriever.lastSkip()).toBeNull();
    expect(own.every((p) => p.sourceApp === null)).toBe(true);
    // Auch die Vektor-Liste allein, vor jeder Fusion.
    const vectors = await vectorSearch(query, {
      vector: bagOfWords('Onboarding Gehalt Bonus'),
      modelKey: 'openai-compatible/bag-a/16',
      text: 'Onboarding Gehalt Bonus',
      limit: 10,
      visibility: OWN_DOCUMENTS_ONLY,
    });
    expect(vectors.map((p) => p.documentTitle)).toEqual(['Eigenes']);
    expect(
      (await retriever.search('Onboarding', 5, { readableApps: ['crm'] })).some(
        (p) => p.sourceApp === 'wiki',
      ),
    ).toBe(false);

    const withWiki = await retriever.search('Onboarding Gehalt Bonus', 5, WIKI_ONLY);
    expect(withWiki[0]?.documentTitle).toBe('Geheim');
  });

  it('ein Abschnitt, den nur der Vektor findet, kommt mit Quelle und Ausschnitt', async () => {
    await addDocument(
      DocumentInput.parse({ title: 'Fahrtkosten', content: 'Kilometerpauschale dreissig Cent' }),
      'usr_test',
    );
    const models = fakeModels({ model: MODEL_A });
    await cycle(models);
    // Kein Wort gemeinsam mit dem Volltext, aber derselbe Wortbeutel.
    const hits = await hybrid(models).search(
      'cent dreissig kilometerpauschale',
      5,
      OWN_DOCUMENTS_ONLY,
    );
    expect(hits[0]).toMatchObject({ documentTitle: 'Fahrtkosten', sourceApp: null });
    expect(hits[0]?.excerpt.length).toBeGreaterThan(0);
  });

  it('bei unvollstaendiger Abdeckung nur Volltext, nach dem Einbetten hybrid', async () => {
    const models = fakeModels({ model: MODEL_A });
    await addDocument(DocumentInput.parse({ title: 'Eins', content: 'Erstes Dokument' }), 'u');
    await cycle(models);
    await addDocument(DocumentInput.parse({ title: 'Zwei', content: 'Zweites Dokument' }), 'u');
    const retriever = hybrid(models);
    await retriever.search('Dokument', 5, OWN_DOCUMENTS_ONLY);
    expect(retriever.lastSkip()).toBe('incomplete');
    await cycle(models);
    await retriever.search('Dokument', 5, OWN_DOCUMENTS_ONLY);
    expect(retriever.lastSkip()).toBeNull();
  });

  it('Anbieter weg: Speichern gelingt, nichts eingebettet, Suche Volltext', async () => {
    const broken = fakeModels({ model: MODEL_A, fail: true });
    const created = await addDocument(
      DocumentInput.parse({ title: 'Neu', content: 'Gespeichert trotz Ausfall' }),
      'u',
    );
    expect(created.chunkCount).toBe(1);
    await cycle(broken);
    expect(await query('select 1 from chunk_embeddings')).toEqual([]);
    const retriever = hybrid(broken);
    expect(await retriever.search('Ausfall', 5, OWN_DOCUMENTS_ONLY)).toHaveLength(1);
    expect(retriever.lastSkip()).toBe('incomplete');
  });

  it('Local-only-Abschnitte: nicht eingebettet, zaehlen nicht gegen die Abdeckung', async () => {
    await upsert({ key: 'deal', title: 'Deal', content: 'Vertraulicher Deal Rabatt' }, 'crm');
    await upsert({ key: 'p1', title: 'Seite', content: 'Rabatt Regeln im Wiki' });
    const models = fakeModels({ model: { ...MODEL_A, local: false }, localOnly: ['crm'] });
    await cycle(models);
    expect(models.sent.map((t) => t.sourceApp)).toEqual(['wiki']);
    const all = await coverage(query, 'openai-compatible/bag-a/16', {
      readableApps: ['crm', 'wiki'],
    });
    expect(all).toMatchObject({ sections: 2, embedded: 1, withheld: 1, pending: 0 });

    const retriever = hybrid(models);
    const hits = await retriever.search('Rabatt', 5, { readableApps: ['crm', 'wiki'] });
    expect(retriever.lastSkip()).toBeNull();
    // Ueber Volltext bleibt der CRM-Abschnitt auffindbar, fuer wer das CRM lesen darf.
    expect(hits.map((p) => p.sourceApp).sort()).toEqual(['crm', 'wiki']);
  });

  it('Modellwechsel: Volltext bis zur Neuberechnung, dann hybrid, alte Vektoren geloescht', async () => {
    await addDocument(DocumentInput.parse({ title: 'Eins', content: 'Urlaub beantragen' }), 'u');
    const first = fakeModels({ model: MODEL_A });
    await cycle(first);

    const second = fakeModels({ model: MODEL_B });
    const retriever = hybrid(second);
    await retriever.search('Urlaub', 5, OWN_DOCUMENTS_ONLY);
    expect(retriever.lastSkip()).toBe('model_changed');
    await retriever.search('Urlaub', 5, OWN_DOCUMENTS_ONLY);
    expect(retriever.lastSkip()).toBe('incomplete');

    const report = await cycle(second);
    expect(report).toMatchObject({ pending: 0, removedOld: 1 });
    await retriever.search('Urlaub', 5, OWN_DOCUMENTS_ONLY);
    expect(retriever.lastSkip()).toBeNull();
    const keys = await query<{ model_key: string }>(
      'select distinct model_key from chunk_embeddings',
    );
    expect(keys.map((k) => k.model_key)).toEqual(['openai-compatible/bag-b/16']);
  });

  it('upsert behaelt unveraenderte Abschnitte samt Vektor und bettet nur Neues ein', async () => {
    const long = Array.from(
      { length: 6 },
      (_, i) => `Absatz ${String(i)} ${'Wort '.repeat(60)}`,
    ).join('\n\n');
    await upsert({ key: 'p1', title: 'Lang', content: long });
    const models = fakeModels({ model: MODEL_A });
    await cycle(models);
    const before = await query<{ id: string; text: string }>(
      'select id::text as id, text from chunks order by ord',
    );
    const sentBefore = models.sent.length;

    await upsert({ key: 'p1', title: 'Lang', content: `${long}\n\nNeuer Schluss` });
    const after = await query<{ id: string; text: string }>(
      'select id::text as id, text from chunks order by ord',
    );
    const kept = after.filter((row) =>
      before.some((old) => old.id === row.id && old.text === row.text),
    );
    expect(kept.length).toBeGreaterThan(0);
    await cycle(models);
    expect(models.sent.length - sentBefore).toBe(after.length - kept.length);
    expect((await coverage(query, 'openai-compatible/bag-a/16', WIKI_ONLY)).pending).toBe(0);
  });
});
