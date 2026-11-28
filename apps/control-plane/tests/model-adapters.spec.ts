/**
 * Vertragstests der Modell-Adapter (ADR 0024 Schritt 1) gegen gestellte
 * HTTP-Antworten. Kein Aufruf an einen echten Anbieter: `fetch` ist ersetzt
 * und merkt sich, was gesendet wurde.
 *
 * Die Formate folgen der Doku der Anbieter:
 *
 * - Anthropic Messages API (`POST /v1/messages`, `anthropic-version: 2023-06-01`)
 * - Gemini API `models/{model}:generateContent` und `:batchEmbedContents`
 * - OpenAI-kompatibel `POST {base}/chat/completions` und `POST {base}/embeddings`
 *
 * Die riskanten Pfade zuerst: Der Schluessel steht nie in der URL, nie in einer
 * Fehlermeldung, auch wenn der Anbieter ihn in seinem Fehlertext wiederholt.
 */

import { describe, expect, it } from 'vitest';
import {
  ANTHROPIC_MESSAGES_URL,
  ANTHROPIC_VERSION,
  createAnthropicProvider,
  createGeminiProvider,
  createOpenAiCompatibleProvider,
  GEMINI_API_BASE,
  type FetchLike,
} from '../src/adapters/models';
import { ModelProviderError } from '../src/domain';
import type { ChatMessage, ChatToolSpec } from '../src/domain';

const KEY = 'sk-fake-adapter-aaaaaaaaaaaaaaaa';

interface Sent {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: Record<string, unknown>;
}

function stubFetch(responses: readonly { status?: number; body: unknown }[]): {
  fetch: FetchLike;
  sent: Sent[];
} {
  const sent: Sent[] = [];
  const queue = [...responses];
  const fetch: FetchLike = async (url, init) => {
    sent.push({
      url,
      headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>)),
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
    });
    const next = queue.shift() ?? { body: {} };
    return new Response(typeof next.body === 'string' ? next.body : JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetch, sent };
}

const TOOL: ChatToolSpec = {
  name: 'crm__contacts__list',
  description: 'crm: list contacts',
  inputSchema: { type: 'object', properties: { args: { type: 'object' } } },
};

/** Ein Verlauf mit allen drei Arten von Nachrichten. */
const HISTORY: ChatMessage[] = [
  { role: 'user', content: 'Who is new in the CRM?' },
  {
    role: 'assistant',
    content: 'Let me look.',
    toolCalls: [{ id: 'call-1', name: 'crm__contacts__list', arguments: { args: { limit: 5 } } }],
  },
  {
    role: 'tool',
    results: [
      { callId: 'call-1', name: 'crm__contacts__list', content: '{"rows":[]}', isError: false },
    ],
  },
];

describe('Anthropic Messages API', () => {
  it('sendet Schluessel nur im Header, Version, System, Tools und den Verlauf im Format der API', async () => {
    const { fetch, sent } = stubFetch([
      {
        body: {
          id: 'msg_01',
          type: 'message',
          role: 'assistant',
          model: 'claude-test',
          content: [
            { type: 'text', text: 'Checking.' },
            { type: 'tool_use', id: 'toolu_01', name: 'crm__contacts__list', input: { args: {} } },
          ],
          stop_reason: 'tool_use',
          stop_sequence: null,
          usage: { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 5 },
        },
      },
    ]);
    const provider = createAnthropicProvider({ apiKey: KEY, fetch });
    const response = await provider.chat({
      model: 'claude-test',
      system: 'Be brief.',
      messages: HISTORY,
      tools: [TOOL],
      maxOutputTokens: 512,
    });

    expect(sent).toHaveLength(1);
    const request = sent[0]!;
    expect(request.url).toBe(ANTHROPIC_MESSAGES_URL);
    expect(request.url).not.toContain(KEY);
    expect(request.headers['x-api-key']).toBe(KEY);
    expect(request.headers['anthropic-version']).toBe(ANTHROPIC_VERSION);
    expect(request.body).toMatchObject({
      model: 'claude-test',
      max_tokens: 512,
      system: 'Be brief.',
      tools: [{ name: TOOL.name, description: TOOL.description, input_schema: TOOL.inputSchema }],
    });
    expect(request.body.messages).toEqual([
      { role: 'user', content: 'Who is new in the CRM?' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me look.' },
          {
            type: 'tool_use',
            id: 'call-1',
            name: 'crm__contacts__list',
            input: { args: { limit: 5 } },
          },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'call-1', content: '{"rows":[]}' }],
      },
    ]);

    expect(response.text).toBe('Checking.');
    expect(response.stopReason).toBe('tool_use');
    expect(response.toolCalls).toEqual([
      { id: 'toolu_01', name: 'crm__contacts__list', arguments: { args: {} } },
    ]);
    expect(response.usage).toEqual({ inputTokens: 125, outputTokens: 30 });
  });

  it('gibt bei einem Fehler nur Status und Fehlerart weiter, nie den Text mit dem Schluessel', async () => {
    const { fetch } = stubFetch([
      {
        status: 401,
        body: {
          type: 'error',
          error: { type: 'authentication_error', message: `invalid x-api-key ${KEY}` },
        },
      },
    ]);
    const provider = createAnthropicProvider({ apiKey: KEY, fetch });
    const error = await provider
      .chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }], maxOutputTokens: 10 })
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ModelProviderError);
    expect((error as Error).message).toBe('anthropic responded 401 (authentication_error)');
    expect((error as Error).message).not.toContain(KEY);
  });

  it('hat keine Embeddings', async () => {
    const provider = createAnthropicProvider({ apiKey: KEY, fetch: stubFetch([]).fetch });
    await expect(provider.embed({ model: 'm', texts: ['a'], dimensions: null })).rejects.toThrow(
      'anthropic offers no embeddings',
    );
  });

  it('ein Netzfehler nennt nur seine Art', async () => {
    const fetch: FetchLike = async () => {
      throw new TypeError(`fetch failed for https://x/?key=${KEY}`);
    };
    const provider = createAnthropicProvider({ apiKey: KEY, fetch });
    const error = await provider
      .chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }], maxOutputTokens: 10 })
      .catch((cause: unknown) => cause);
    expect((error as Error).message).toBe('anthropic could not be reached (TypeError)');
  });
});

describe('Gemini API', () => {
  it('generateContent: Schluessel im Header x-goog-api-key, nicht als ?key=, Verlauf mit role model und functionResponse', async () => {
    const { fetch, sent } = stubFetch([
      {
        body: {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  { text: 'thinking', thought: true },
                  { text: 'Found it.' },
                  {
                    functionCall: { name: 'crm__contacts__list', args: { args: { limit: 1 } } },
                    thoughtSignature: 'sig-abc',
                  },
                ],
              },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 200,
            candidatesTokenCount: 40,
            thoughtsTokenCount: 10,
            totalTokenCount: 250,
          },
        },
      },
    ]);
    const provider = createGeminiProvider({ apiKey: KEY, fetch });
    const response = await provider.chat({
      model: 'models/gemini-test',
      system: 'Be brief.',
      messages: HISTORY,
      tools: [TOOL],
      maxOutputTokens: 256,
    });

    const request = sent[0]!;
    expect(request.url).toBe(`${GEMINI_API_BASE}/models/gemini-test:generateContent`);
    expect(request.url).not.toContain(KEY);
    expect(request.url).not.toContain('key=');
    expect(request.headers['x-goog-api-key']).toBe(KEY);
    expect(request.body).toMatchObject({
      systemInstruction: { parts: [{ text: 'Be brief.' }] },
      generationConfig: { maxOutputTokens: 256 },
      tools: [
        {
          functionDeclarations: [
            {
              name: TOOL.name,
              description: TOOL.description,
              parametersJsonSchema: TOOL.inputSchema,
            },
          ],
        },
      ],
    });
    expect(request.body.contents).toEqual([
      { role: 'user', parts: [{ text: 'Who is new in the CRM?' }] },
      {
        role: 'model',
        parts: [
          { text: 'Let me look.' },
          { functionCall: { name: 'crm__contacts__list', args: { args: { limit: 5 } } } },
        ],
      },
      {
        role: 'user',
        parts: [
          {
            functionResponse: { name: 'crm__contacts__list', response: { content: '{"rows":[]}' } },
          },
        ],
      },
    ]);

    expect(response.text).toBe('Found it.');
    expect(response.stopReason).toBe('tool_use');
    expect(response.toolCalls).toEqual([
      { id: 'gemini-call-2', name: 'crm__contacts__list', arguments: { args: { limit: 1 } } },
    ]);
    expect(response.usage).toEqual({ inputTokens: 200, outputTokens: 50 });
  });

  it('gibt die rohen Teile mit Signatur in der naechsten Runde unveraendert zurueck', async () => {
    const parts = [{ functionCall: { name: 'x', args: {} }, thoughtSignature: 'sig-abc' }];
    const { fetch, sent } = stubFetch([{ body: { candidates: [] } }]);
    const provider = createGeminiProvider({ apiKey: KEY, fetch });
    await provider.chat({
      model: 'gemini-test',
      messages: [
        { role: 'user', content: 'go' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'a', name: 'x', arguments: {} }],
          raw: { provider: 'gemini', value: parts },
        },
        { role: 'tool', results: [{ callId: 'a', name: 'x', content: 'no', isError: true }] },
      ],
      maxOutputTokens: 10,
    });
    const contents = sent[0]!.body.contents as unknown[];
    expect(contents[1]).toEqual({ role: 'model', parts });
    expect(contents[2]).toEqual({
      role: 'user',
      parts: [{ functionResponse: { name: 'x', response: { error: 'no' } } }],
    });
  });

  it('batchEmbedContents mit outputDimensionality, Vektoren in Reihenfolge', async () => {
    const { fetch, sent } = stubFetch([
      { body: { embeddings: [{ values: [0.1, 0.2] }, { values: [0.3, 0.4] }] } },
    ]);
    const provider = createGeminiProvider({ apiKey: KEY, fetch });
    const response = await provider.embed({
      model: 'gemini-embedding-test',
      texts: ['first text', 'second'],
      dimensions: 2,
    });
    const request = sent[0]!;
    expect(request.url).toBe(`${GEMINI_API_BASE}/models/gemini-embedding-test:batchEmbedContents`);
    expect(request.headers['x-goog-api-key']).toBe(KEY);
    expect(request.body).toEqual({
      requests: [
        {
          model: 'models/gemini-embedding-test',
          content: { parts: [{ text: 'first text' }] },
          outputDimensionality: 2,
        },
        {
          model: 'models/gemini-embedding-test',
          content: { parts: [{ text: 'second' }] },
          outputDimensionality: 2,
        },
      ],
    });
    expect(response.vectors).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    // Die API nennt keine Tokens: geschaetzt mit vier Zeichen je Token.
    expect(response.usage).toEqual({ inputTokens: 3 + 2, outputTokens: 0 });
  });

  it('ein Fehler mit dem Schluessel im Text gibt nur Status und Art weiter', async () => {
    const { fetch } = stubFetch([
      {
        status: 400,
        body: {
          error: { code: 400, message: `API key not valid: ${KEY}`, status: 'INVALID_ARGUMENT' },
        },
      },
    ]);
    const provider = createGeminiProvider({ apiKey: KEY, fetch });
    const error = await provider
      .chat({ model: 'g', messages: [{ role: 'user', content: 'hi' }], maxOutputTokens: 10 })
      .catch((cause: unknown) => cause);
    expect((error as Error).message).toBe('gemini responded 400 (INVALID_ARGUMENT)');
  });
});

describe('OpenAI-kompatibel', () => {
  it('chat/completions: Bearer, System zuerst, tool_calls als JSON-Text, Ergebnisse als role tool', async () => {
    const { fetch, sent } = stubFetch([
      {
        body: {
          id: 'chatcmpl-1',
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call_abc',
                    type: 'function',
                    function: { name: 'crm__contacts__list', arguments: '{"args":{"limit":2}}' },
                  },
                  {
                    id: 'call_bad',
                    type: 'function',
                    function: { name: 'crm__contacts__list', arguments: '{not json' },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
          usage: { prompt_tokens: 90, completion_tokens: 12, total_tokens: 102 },
        },
      },
    ]);
    const provider = createOpenAiCompatibleProvider({
      baseUrl: 'https://api.example.test/v1/',
      apiKey: KEY,
      local: false,
      fetch,
    });
    const response = await provider.chat({
      model: 'gpt-test',
      system: 'Be brief.',
      messages: HISTORY,
      tools: [TOOL],
      maxOutputTokens: 300,
    });

    const request = sent[0]!;
    expect(request.url).toBe('https://api.example.test/v1/chat/completions');
    expect(request.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(request.body).toMatchObject({
      model: 'gpt-test',
      max_tokens: 300,
      tools: [
        {
          type: 'function',
          function: {
            name: TOOL.name,
            description: TOOL.description,
            parameters: TOOL.inputSchema,
          },
        },
      ],
    });
    expect(request.body.messages).toEqual([
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'Who is new in the CRM?' },
      {
        role: 'assistant',
        content: 'Let me look.',
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'crm__contacts__list', arguments: '{"args":{"limit":5}}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call-1', content: '{"rows":[]}' },
    ]);
    expect(response.stopReason).toBe('tool_use');
    expect(response.toolCalls[0]).toEqual({
      id: 'call_abc',
      name: 'crm__contacts__list',
      arguments: { args: { limit: 2 } },
    });
    // Ungueltiges JSON wird nicht still zu `{}`: Es ist als Fehler markiert.
    expect(response.toolCalls[1]?.argumentsError).toBe('arguments are not a JSON object');
    expect(response.usage).toEqual({ inputTokens: 90, outputTokens: 12 });
  });

  it('lokal ohne Schluessel: kein Authorization-Header (Ollama)', async () => {
    const { fetch, sent } = stubFetch([
      {
        body: {
          choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 3, completion_tokens: 1 },
        },
      },
    ]);
    const provider = createOpenAiCompatibleProvider({
      baseUrl: 'http://ollama:11434/v1',
      apiKey: null,
      local: true,
      fetch,
    });
    expect(provider.local).toBe(true);
    const response = await provider.chat({
      model: 'llama-test',
      messages: [{ role: 'user', content: 'hi' }],
      maxOutputTokens: 5,
    });
    expect(sent[0]!.url).toBe('http://ollama:11434/v1/chat/completions');
    expect(sent[0]!.headers.authorization).toBeUndefined();
    expect(response).toMatchObject({ text: 'hi', stopReason: 'end' });
  });

  it('embeddings: Vektoren nach index geordnet, dimensions nur mit Angabe', async () => {
    const { fetch, sent } = stubFetch([
      {
        body: {
          object: 'list',
          data: [
            { object: 'embedding', index: 1, embedding: [0.5, 0.6] },
            { object: 'embedding', index: 0, embedding: [0.1, 0.2] },
          ],
          model: 'embed-test',
          usage: { prompt_tokens: 7, total_tokens: 7 },
        },
      },
      { body: { data: [{ index: 0, embedding: [1, 2, 3] }], usage: { prompt_tokens: 2 } } },
    ]);
    const provider = createOpenAiCompatibleProvider({
      baseUrl: 'https://api.example.test/v1',
      apiKey: KEY,
      local: false,
      fetch,
    });
    const response = await provider.embed({
      model: 'embed-test',
      texts: ['a', 'b'],
      dimensions: 2,
    });
    expect(sent[0]!.url).toBe('https://api.example.test/v1/embeddings');
    expect(sent[0]!.body).toEqual({ model: 'embed-test', input: ['a', 'b'], dimensions: 2 });
    expect(response.vectors).toEqual([
      [0.1, 0.2],
      [0.5, 0.6],
    ]);
    expect(response.usage.inputTokens).toBe(7);

    await provider.embed({ model: 'embed-test', texts: ['c'], dimensions: null });
    expect(sent[1]!.body).toEqual({ model: 'embed-test', input: ['c'] });
  });

  it('ein Fehler, der den Schluessel wiederholt, verliert ihn', async () => {
    const { fetch } = stubFetch([
      {
        status: 401,
        body: {
          error: {
            message: `Incorrect API key provided: ${KEY}.`,
            type: 'invalid_request_error',
            code: 'invalid_api_key',
          },
        },
      },
    ]);
    const provider = createOpenAiCompatibleProvider({
      baseUrl: 'https://api.example.test/v1',
      apiKey: KEY,
      local: false,
      fetch,
    });
    const error = await provider
      .embed({ model: 'e', texts: ['a'], dimensions: null })
      .catch((cause: unknown) => cause);
    expect((error as Error).message).toBe(
      'openai-compatible responded 401 (invalid_request_error)',
    );
    expect(JSON.stringify(error)).not.toContain(KEY);
  });

  it('eine Antwort mit falscher Zahl Vektoren ist ein Fehler', async () => {
    const { fetch } = stubFetch([{ body: { data: [] } }]);
    const provider = createOpenAiCompatibleProvider({
      baseUrl: 'https://api.example.test/v1',
      apiKey: KEY,
      local: false,
      fetch,
    });
    await expect(provider.embed({ model: 'e', texts: ['a'], dimensions: null })).rejects.toThrow(
      'different number of embeddings',
    );
  });
});
