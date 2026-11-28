/**
 * Anthropic (Claude) ueber die Messages API, `POST /v1/messages`, Version
 * `2023-06-01`. Schluessel im Header `x-api-key`. Anthropic hat keine eigene
 * Embedding-API; `embed` wirft (ADR 0024 A).
 *
 * Abbildung des Verlaufs:
 *
 * - `user` -> `{ role: 'user', content: text }`
 * - `assistant` -> Bloecke `text` und `tool_use` (`id`, `name`, `input`)
 * - `tool` -> eine Nachricht `user` mit Bloecken `tool_result`
 *   (`tool_use_id`, `content`, `is_error`)
 */

import { ModelProviderError } from '../../domain/errors';
import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ChatToolCall,
  ModelProvider,
} from '../../domain/ports';
import { asRecord, postJson, tokenCount, type FetchLike } from './http';

export const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';

export interface AnthropicOptions {
  readonly apiKey: string;
  readonly fetch?: FetchLike;
  readonly timeoutMs?: number;
}

function toAnthropicMessages(messages: readonly ChatMessage[]): unknown[] {
  return messages.map((message) => {
    if (message.role === 'user') return { role: 'user', content: message.content };
    if (message.role === 'tool') {
      return {
        role: 'user',
        content: message.results.map((result) => ({
          type: 'tool_result',
          tool_use_id: result.callId,
          content: result.content,
          ...(result.isError ? { is_error: true } : {}),
        })),
      };
    }
    // Die rohen Bloecke der letzten Antwort, wenn sie von hier stammen
    // (etwa mit Denk-Bloecken, die Anthropic unveraendert zurueck verlangt).
    if (message.raw?.provider === 'anthropic' && Array.isArray(message.raw.value)) {
      return { role: 'assistant', content: message.raw.value };
    }
    const blocks: unknown[] = [];
    if (message.content !== '') blocks.push({ type: 'text', text: message.content });
    for (const call of message.toolCalls) {
      blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments });
    }
    return { role: 'assistant', content: blocks };
  });
}

function stopReasonOf(value: unknown): ChatResponse['stopReason'] {
  if (value === 'end_turn' || value === 'stop_sequence') return 'end';
  if (value === 'tool_use') return 'tool_use';
  if (value === 'max_tokens') return 'max_tokens';
  return 'other';
}

export function createAnthropicProvider(options: AnthropicOptions): ModelProvider {
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  return {
    kind: 'anthropic',
    local: false,

    async chat(request: ChatRequest): Promise<ChatResponse> {
      const payload = await postJson({
        provider: 'anthropic',
        url: ANTHROPIC_MESSAGES_URL,
        headers: { 'x-api-key': options.apiKey, 'anthropic-version': ANTHROPIC_VERSION },
        body: {
          model: request.model,
          max_tokens: request.maxOutputTokens,
          ...(request.system === undefined || request.system === ''
            ? {}
            : { system: request.system }),
          messages: toAnthropicMessages(request.messages),
          ...(request.tools === undefined || request.tools.length === 0
            ? {}
            : {
                tools: request.tools.map((tool) => ({
                  name: tool.name,
                  description: tool.description,
                  input_schema: tool.inputSchema,
                })),
              }),
        },
        timeoutMs: options.timeoutMs ?? 120_000,
        secret: options.apiKey,
        fetch: doFetch,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      });

      const body = asRecord(payload, 'anthropic');
      const content = Array.isArray(body.content) ? body.content : [];
      const texts: string[] = [];
      const toolCalls: ChatToolCall[] = [];
      for (const block of content) {
        if (typeof block !== 'object' || block === null) continue;
        const entry = block as Record<string, unknown>;
        if (entry.type === 'text' && typeof entry.text === 'string') texts.push(entry.text);
        if (
          entry.type === 'tool_use' &&
          typeof entry.id === 'string' &&
          typeof entry.name === 'string'
        ) {
          const input = entry.input;
          const valid = typeof input === 'object' && input !== null && !Array.isArray(input);
          toolCalls.push({
            id: entry.id,
            name: entry.name,
            arguments: valid ? (input as Record<string, unknown>) : {},
            ...(valid ? {} : { argumentsError: 'arguments are not an object' }),
          });
        }
      }
      const usage = asRecord(body.usage ?? {}, 'anthropic');
      return {
        text: texts.join(''),
        toolCalls,
        stopReason: stopReasonOf(body.stop_reason),
        usage: {
          // Zwischengespeicherte Eingabe zaehlt mit: Sie ist Teil des Aufrufs.
          inputTokens:
            tokenCount(usage.input_tokens) +
            tokenCount(usage.cache_creation_input_tokens) +
            tokenCount(usage.cache_read_input_tokens),
          outputTokens: tokenCount(usage.output_tokens),
        },
        raw: content,
      };
    },

    async embed(): Promise<never> {
      throw new ModelProviderError('anthropic offers no embeddings');
    },
  };
}
