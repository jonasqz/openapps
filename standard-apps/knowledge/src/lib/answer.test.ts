import { describe, expect, it, vi } from 'vitest';
import {
  answerQuestion,
  askerOf,
  checkCitations,
  NOT_CONFIGURED_MESSAGE,
  parseModelAnswer,
} from './answer';
import type {
  GenerateOutcome,
  GenerateRequest,
  ModelInfo,
  PlatformModels,
} from './platform-models';
import type { Passage, Retriever } from './retriever';
import type { Visibility } from './visibility';

/**
 * `answer` mit gestelltem Modell (ADR 0025 E). Kein echter Anbieter. Riskant
 * zuerst:
 *
 * - Ein Zitat auf einen Abschnitt, der nicht uebergeben wurde, verwirft die
 *   Antwort (`no_answer`), auch wenn andere Zitate stimmen.
 * - Ein Zitat auf einen zurueckgehaltenen Abschnitt (Local-only-App,
 *   externer Anbieter) gilt als erfunden: Das Modell hatte ihn nicht.
 * - Nur die Abschnitte der Suche mit der Sichtbarkeit des Aufrufers gehen an
 *   `generate`, jeder mit seiner Quell-App.
 * - Ohne Chat-Modell `not_configured`, ohne Suche und ohne Aufruf.
 */

const passage = (chunkId: string, sourceApp: string | null = null): Passage => ({
  chunkId,
  documentId: `d-${chunkId}`,
  documentTitle: `Title ${chunkId}`,
  source: null,
  sourceApp,
  sourcePath: sourceApp === null ? null : `/pages/${chunkId}`,
  sourceUrl: sourceApp === null ? null : `https://apps.example.test/${sourceApp}/pages/${chunkId}`,
  ord: 1,
  score: 0.5,
  excerpt: 'e',
  text: `Text of ${chunkId}`,
});

const WIKI: Visibility = { readableApps: ['wiki'] };
const CHAT_INFO: ModelInfo = {
  status: 'ok',
  chat: { provider: 'anthropic', model: 'm', local: false },
  embedding: null,
  budget: null,
};

function setup(options: { passages: Passage[]; reply?: GenerateOutcome; info?: ModelInfo }): {
  retriever: Retriever & { search: ReturnType<typeof vi.fn> };
  models: PlatformModels & { generate: ReturnType<typeof vi.fn> };
  requests: GenerateRequest[];
} {
  const requests: GenerateRequest[] = [];
  const retriever = { search: vi.fn(async () => options.passages) };
  const models = {
    info: vi.fn(async () => options.info ?? CHAT_INFO),
    embed: vi.fn(async () => ({ status: 'not_configured' as const })),
    generate: vi.fn(async (request: GenerateRequest) => {
      requests.push(request);
      return options.reply ?? { status: 'error' as const };
    }),
  };
  return { retriever, models, requests };
}

const ask = (deps: ReturnType<typeof setup>, question = 'How much is the mileage allowance?') =>
  answerQuestion(
    { retriever: deps.retriever, models: deps.models },
    { question, limit: 8, visibility: WIKI, onBehalfOf: 'user:u-anna' },
  );

const reply = (value: unknown, withheld: string[] = []): GenerateOutcome => ({
  status: 'ok',
  text: typeof value === 'string' ? value : JSON.stringify(value),
  withheld,
});

describe('Zitate werden geprueft', () => {
  it('ein erfundenes Zitat verwirft die ganze Antwort', async () => {
    const deps = setup({
      passages: [passage('c1'), passage('c2', 'wiki')],
      reply: reply({ answer: '30 cents per km.', citations: ['c1', 'c-invented'] }),
    });
    const result = await ask(deps);
    expect(result).toMatchObject({ status: 'no_answer', reason: 'invalid_citation' });
    // Mit den Abschnitten, damit der Aufrufer selbst antworten kann.
    if (result.status === 'no_answer') {
      expect(result.passages.map((p) => p.chunkId)).toEqual(['c1', 'c2']);
    }
  });

  it('ein Zitat auf einen zurueckgehaltenen Abschnitt gilt als erfunden', async () => {
    const deps = setup({
      passages: [passage('c1'), passage('crm-1', 'crm')],
      reply: reply({ answer: 'The deal is worth a lot.', citations: ['crm-1'] }, ['crm-1']),
    });
    expect(await ask(deps)).toMatchObject({ status: 'no_answer', reason: 'invalid_citation' });
  });

  it('eine Antwort ohne Zitat wird verworfen', async () => {
    const deps = setup({
      passages: [passage('c1')],
      reply: reply({ answer: '30 cents per km.', citations: [] }),
    });
    expect(await ask(deps)).toMatchObject({ status: 'no_answer', reason: 'no_citation' });
  });

  it('sagt das Modell, die Abschnitte beantworten es nicht: no_answer, nicht geraten', async () => {
    const deps = setup({
      passages: [passage('c1')],
      reply: reply({ answer: null, citations: [] }),
    });
    expect(await ask(deps)).toMatchObject({ status: 'no_answer', reason: 'not_in_sources' });
  });

  it('Text ohne JSON ist keine Antwort', async () => {
    const deps = setup({ passages: [passage('c1')], reply: reply('It is 30 cents [c1].') });
    expect(await ask(deps)).toMatchObject({ status: 'no_answer', reason: 'unreadable' });
  });

  it('eine gueltige Antwort kommt mit Zitaten auf die uebergebenen Abschnitte', async () => {
    const deps = setup({
      passages: [passage('c1'), passage('c2', 'wiki')],
      reply: reply('```json\n{"answer": "30 cents per km.", "citations": ["c2", "c2"]}\n```'),
    });
    const result = await ask(deps);
    expect(result.status).toBe('answered');
    if (result.status !== 'answered') return;
    expect(result.answer).toBe('30 cents per km.');
    expect(result.citations).toEqual([
      {
        chunkId: 'c2',
        documentId: 'd-c2',
        documentTitle: 'Title c2',
        ord: 1,
        source: null,
        sourceApp: 'wiki',
        sourcePath: '/pages/c2',
        sourceUrl: 'https://apps.example.test/wiki/pages/c2',
      },
    ]);
  });
});

describe('was an generate geht', () => {
  it('nur die Abschnitte der Suche mit der Sichtbarkeit des Aufrufers, mit Quell-App', async () => {
    const deps = setup({
      passages: [passage('c1'), passage('c2', 'wiki')],
      reply: reply({ answer: 'x', citations: ['c1'] }),
    });
    await ask(deps);
    expect(deps.retriever.search).toHaveBeenCalledWith(
      'How much is the mileage allowance?',
      8,
      WIKI,
    );
    const request = deps.requests[0];
    expect(request?.contents.map((c) => [c.id, c.sourceApp])).toEqual([
      ['c1', 'knowledge'],
      ['c2', 'wiki'],
    ]);
    expect(request?.onBehalfOf).toBe('user:u-anna');
    expect(request?.instruction).toContain('How much is the mileage allowance?');
  });

  it('ohne Treffer kein Aufruf des Modells', async () => {
    const deps = setup({ passages: [] });
    expect(await ask(deps)).toMatchObject({ status: 'no_answer', reason: 'no_passages' });
    expect(deps.models.generate).not.toHaveBeenCalled();
  });

  it('hat die Plattform alles zurueckgehalten: no_answer, keine Antwort', async () => {
    const deps = setup({
      passages: [passage('crm-1', 'crm')],
      reply: { status: 'withheld', withheld: ['crm-1'] },
    });
    expect(await ask(deps)).toMatchObject({ status: 'no_answer', reason: 'withheld' });
  });
});

describe('ohne Chat-Modell', () => {
  it('not_configured mit Hinweis auf search, ohne Suche und ohne Aufruf', async () => {
    for (const info of [
      { status: 'not_configured' },
      { status: 'no_platform' },
      { status: 'denied' },
      { status: 'ok', chat: null, embedding: null, budget: null },
    ] as ModelInfo[]) {
      const deps = setup({ passages: [passage('c1')], info });
      expect(await ask(deps)).toEqual({
        status: 'not_configured',
        message: NOT_CONFIGURED_MESSAGE,
      });
      expect(deps.retriever.search).not.toHaveBeenCalled();
      expect(deps.models.generate).not.toHaveBeenCalled();
    }
    expect(NOT_CONFIGURED_MESSAGE).toMatch(/search/);
  });

  it('Tagesgrenze oder Fehler des Anbieters: no_answer mit den Abschnitten', async () => {
    const budget = setup({ passages: [passage('c1')], reply: { status: 'budget_exceeded' } });
    expect(await ask(budget)).toMatchObject({ status: 'no_answer', reason: 'budget_exceeded' });
    const broken = setup({ passages: [passage('c1')], reply: { status: 'error' } });
    expect(await ask(broken)).toMatchObject({ status: 'no_answer', reason: 'model_error' });
  });
});

describe('Bausteine', () => {
  it('parseModelAnswer nimmt nur die verlangte Form', () => {
    expect(parseModelAnswer('{"answer": "a", "citations": ["x"]}')).toEqual({
      answer: 'a',
      citations: ['x'],
    });
    expect(parseModelAnswer('{"answer": 3, "citations": []}')).toBeNull();
    expect(parseModelAnswer('{"answer": "a", "citations": [1]}')).toBeNull();
    expect(parseModelAnswer('no json')).toBeNull();
    expect(parseModelAnswer('{"answer": "  ", "citations": []}')).toEqual({
      answer: null,
      citations: [],
    });
  });

  it('checkCitations kennt nur, was uebergeben wurde', () => {
    const given = new Map([['c1', passage('c1')]]);
    expect(checkCitations(['c1'], given)).toMatchObject({ ok: true });
    expect(checkCitations(['c2'], given)).toEqual({ ok: false, reason: 'invalid_citation' });
    expect(checkCitations([], given)).toEqual({ ok: false, reason: 'no_citation' });
  });

  it('askerOf nennt Mensch, Agent und App in der Form der Plattform', () => {
    expect(askerOf({ kind: 'human', id: 'u-1' })).toBe('user:u-1');
    expect(askerOf({ kind: 'agent', agent: 'recherche' })).toBe('agent:recherche');
    expect(askerOf({ kind: 'app', app: 'wiki' })).toBe('app:wiki');
    expect(askerOf({ kind: 'human', id: 'a b' })).toBeNull();
  });
});
