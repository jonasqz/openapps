/**
 * OpenAI und jeder kompatible Endpunkt (auch lokal, etwa Ollama unter
 * `http://ollama:11434/v1`): `POST {base}/chat/completions` und
 * `POST {base}/embeddings`. Schluessel als `Authorization: Bearer`; ohne
 * Schluessel (lokal) kein Header.
 *
 * Abbildung des Verlaufs:
 *
 * - `system` -> erste Nachricht `{ role: 'system' }`
 * - `user` -> `{ role: 'user', content }`
 * - `assistant` -> `{ role: 'assistant', content, tool_calls: [{ id, type:
 *   'function', function: { name, arguments } }] }`, `arguments` als JSON-Text
 * - `tool` -> je Ergebnis `{ role: 'tool', tool_call_id, content }`
 */

import { ModelProviderError } from '../../domain/errors';
import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ChatToolCall,
  EmbedRequest,
  EmbedResponse,
  ModelProvider,
} from '../../domain/ports';
import { asRecord, asVector, estimateTokens, postJson, tokenCount, type FetchLike } from './http';

/** Basis-URL, wenn `OPENAPPS_*_BASE_URL` fehlt: der Endpunkt von OpenAI selbst. */
export const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const EMBED_BATCH = 100;

export interface OpenAiCompatibleOptions {
  readonly baseUrl: string;
  readonly apiKey: string | null;
  readonly local: boolean;
  readonly fetch?: FetchLike;
  readonly timeoutMs?: number;
}

function toOpenAiMessages(system: string | undefined, messages: readonly ChatMessage[]): unknown[] {
  const out: unknown[] = [];
  if (system !== undefined && system !== '') out.push({ role: 'system', content: system });
  for (const message of messages) {
    if (message.role === 'user') {
      out.push({ role: 'user', content: message.content });
    } else if (message.role === 'tool') {
      for (const result of message.results) {
        out.push({ role: 'tool', tool_call_id: result.callId, content: result.content });
      }
    } else {
      out.push({
        role: 'assistant',
        content: message.content === '' ? null : message.content,
        ...(message.toolCalls.length === 0
          ? {}
          : {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: JSON.stringify(call.arguments) },
              })),
            }),
      });
    }
  }
  return out;
}

function parseArguments(value: unknown): { args: Record<string, unknown>; error?: string } {
  if (typeof value !== 'string' || value.trim() === '') return { args: {} };
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return { args: parsed as Record<string, unknown> };
    }
  } catch {
    // unten
  }
  return { args: {}, error: 'arguments are not a JSON object' };
}

function stopReasonOf(value: unknown, hasCalls: boolean): ChatResponse['stopReason'] {
  if (hasCalls || value === 'tool_calls') return 'tool_use';
  if (value === 'stop') return 'end';
  if (value === 'length') return 'max_tokens';
  return 'other';
}

export function createOpenAiCompatibleProvider(options: OpenAiCompatibleOptions): ModelProvider {
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const base = options.baseUrl.replace(/\/+$/, '');
  const headers: Record<string, string> =
    options.apiKey === null ? {} : { authorization: `Bearer ${options.apiKey}` };
  const provider = 'openai-compatible';

  return {
    kind: 'openai-compatible',
    local: options.local,

    async chat(request: ChatRequest): Promise<ChatResponse> {
      const payload = await postJson({
        provider,
        url: `${base}/chat/completions`,
        headers,
        body: {
          model: request.model,
          messages: toOpenAiMessages(request.system, request.messages),
          max_tokens: request.maxOutputTokens,
          ...(request.tools === undefined || request.tools.length === 0
            ? {}
            : {
                tools: request.tools.map((tool) => ({
                  type: 'function',
                  function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.inputSchema,
                  },
                })),
              }),
        },
        timeoutMs: options.timeoutMs ?? 120_000,
        secret: options.apiKey,
        fetch: doFetch,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      });

      const body = asRecord(payload, provider);
      const choices = Array.isArray(body.choices) ? body.choices : [];
      const choice =
        typeof choices[0] === 'object' && choices[0] !== null
          ? (choices[0] as Record<string, unknown>)
          : {};
      const message =
        typeof choice.message === 'object' && choice.message !== null
          ? (choice.message as Record<string, unknown>)
          : {};
      const toolCalls: ChatToolCall[] = [];
      const rawCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      rawCalls.forEach((entry, index) => {
        if (typeof entry !== 'object' || entry === null) return;
        const call = entry as Record<string, unknown>;
        const fn =
          typeof call.function === 'object' && call.function !== null
            ? (call.function as Record<string, unknown>)
            : {};
        if (typeof fn.name !== 'string') return;
        const parsed = parseArguments(fn.arguments);
        toolCalls.push({
          id: typeof call.id === 'string' && call.id !== '' ? call.id : `call-${String(index)}`,
          name: fn.name,
          arguments: parsed.args,
          ...(parsed.error === undefined ? {} : { argumentsError: parsed.error }),
        });
      });
      const usage = asRecord(body.usage ?? {}, provider);
      return {
        text: typeof message.content === 'string' ? message.content : '',
        toolCalls,
        stopReason: stopReasonOf(choice.finish_reason, toolCalls.length > 0),
        usage: {
          inputTokens: tokenCount(usage.prompt_tokens),
          outputTokens: tokenCount(usage.completion_tokens),
        },
      };
    },

    async embed(request: EmbedRequest): Promise<EmbedResponse> {
      const vectors: number[][] = [];
      let inputTokens = 0;
      for (let start = 0; start < request.texts.length; start += EMBED_BATCH) {
        const batch = request.texts.slice(start, start + EMBED_BATCH);
        const payload = await postJson({
          provider,
          url: `${base}/embeddings`,
          headers,
          body: {
            model: request.model,
            input: batch,
            ...(request.dimensions === null ? {} : { dimensions: request.dimensions }),
          },
          timeoutMs: options.timeoutMs ?? 60_000,
          secret: options.apiKey,
          fetch: doFetch,
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        });
        const body = asRecord(payload, provider);
        const data = Array.isArray(body.data) ? body.data : [];
        if (data.length !== batch.length) {
          throw new ModelProviderError(`${provider} sent a different number of embeddings`);
        }
        const ordered = data
          .map((entry, position) => {
            const record = asRecord(entry, provider);
            const index = typeof record.index === 'number' ? record.index : position;
            return { index, vector: asVector(record.embedding, provider) };
          })
          .sort((a, b) => a.index - b.index);
        for (const entry of ordered) vectors.push(entry.vector);
        const usage = asRecord(body.usage ?? {}, provider);
        const counted = tokenCount(usage.prompt_tokens);
        inputTokens += counted > 0 ? counted : estimateTokens(batch);
      }
      return { vectors, usage: { inputTokens, outputTokens: 0 } };
    },
  };
}
