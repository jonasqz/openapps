/**
 * Google Gemini ueber die Gemini API (`generativelanguage.googleapis.com`,
 * `v1beta`): `models/{model}:generateContent` fuer Chat und
 * `models/{model}:batchEmbedContents` fuer Embeddings. Schluessel im Header
 * `x-goog-api-key`, **nicht** als `?key=` in der URL (siehe `http.ts`).
 *
 * Abbildung des Verlaufs:
 *
 * - `user` -> `{ role: 'user', parts: [{ text }] }`
 * - `assistant` -> `{ role: 'model', parts: [{ text }, { functionCall }] }`;
 *   die rohen Teile der letzten Antwort gehen unveraendert zurueck, weil
 *   neuere Modelle ihre `thoughtSignature` dort wiedersehen wollen
 * - `tool` -> `{ role: 'user', parts: [{ functionResponse: { name, response } }] }`
 *
 * Tools werden mit `parametersJsonSchema` beschrieben (JSON Schema), nicht
 * mit dem OpenAPI-Teilschema `parameters`: Die Argumente der App-Tools sind
 * ein offenes Objekt, und das Teilschema verlangt fuer jedes Objekt Felder.
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

export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
/** Hoechstens so viele Texte je `batchEmbedContents`. */
const EMBED_BATCH = 100;

export interface GeminiOptions {
  readonly apiKey: string;
  readonly fetch?: FetchLike;
  readonly timeoutMs?: number;
}

/** `models/gemini-…` und `gemini-…` meinen dasselbe Modell. */
export function geminiModelId(model: string): string {
  return model.startsWith('models/') ? model.slice('models/'.length) : model;
}

function modelUrl(model: string, method: string): string {
  return `${GEMINI_API_BASE}/models/${encodeURIComponent(geminiModelId(model))}:${method}`;
}

function toContents(messages: readonly ChatMessage[]): unknown[] {
  return messages.map((message) => {
    if (message.role === 'user') return { role: 'user', parts: [{ text: message.content }] };
    if (message.role === 'tool') {
      return {
        role: 'user',
        parts: message.results.map((result) => ({
          functionResponse: {
            name: result.name,
            response: result.isError ? { error: result.content } : { content: result.content },
          },
        })),
      };
    }
    if (message.raw?.provider === 'gemini' && Array.isArray(message.raw.value)) {
      return { role: 'model', parts: message.raw.value };
    }
    const parts: unknown[] = [];
    if (message.content !== '') parts.push({ text: message.content });
    for (const call of message.toolCalls) {
      parts.push({ functionCall: { name: call.name, args: call.arguments } });
    }
    return { role: 'model', parts };
  });
}

function stopReasonOf(value: unknown, hasCalls: boolean): ChatResponse['stopReason'] {
  if (hasCalls) return 'tool_use';
  if (value === 'STOP') return 'end';
  if (value === 'MAX_TOKENS') return 'max_tokens';
  return 'other';
}

export function createGeminiProvider(options: GeminiOptions): ModelProvider {
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const headers = { 'x-goog-api-key': options.apiKey };

  return {
    kind: 'gemini',
    local: false,

    async chat(request: ChatRequest): Promise<ChatResponse> {
      const payload = await postJson({
        provider: 'gemini',
        url: modelUrl(request.model, 'generateContent'),
        headers,
        body: {
          contents: toContents(request.messages),
          ...(request.system === undefined || request.system === ''
            ? {}
            : { systemInstruction: { parts: [{ text: request.system }] } }),
          ...(request.tools === undefined || request.tools.length === 0
            ? {}
            : {
                tools: [
                  {
                    functionDeclarations: request.tools.map((tool) => ({
                      name: tool.name,
                      description: tool.description,
                      parametersJsonSchema: tool.inputSchema,
                    })),
                  },
                ],
              }),
          generationConfig: { maxOutputTokens: request.maxOutputTokens },
        },
        timeoutMs: options.timeoutMs ?? 120_000,
        secret: options.apiKey,
        fetch: doFetch,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      });

      const body = asRecord(payload, 'gemini');
      const candidates = Array.isArray(body.candidates) ? body.candidates : [];
      const first =
        typeof candidates[0] === 'object' && candidates[0] !== null
          ? (candidates[0] as Record<string, unknown>)
          : {};
      const content =
        typeof first.content === 'object' && first.content !== null
          ? (first.content as Record<string, unknown>)
          : {};
      const parts = Array.isArray(content.parts) ? content.parts : [];

      const texts: string[] = [];
      const toolCalls: ChatToolCall[] = [];
      parts.forEach((part, index) => {
        if (typeof part !== 'object' || part === null) return;
        const entry = part as Record<string, unknown>;
        // Gedanken des Modells gehoeren nicht in die Antwort.
        if (typeof entry.text === 'string' && entry.thought !== true) texts.push(entry.text);
        const call = entry.functionCall;
        if (typeof call === 'object' && call !== null) {
          const fn = call as Record<string, unknown>;
          if (typeof fn.name !== 'string') return;
          const args = fn.args ?? {};
          const valid = typeof args === 'object' && args !== null && !Array.isArray(args);
          toolCalls.push({
            id: typeof fn.id === 'string' && fn.id !== '' ? fn.id : `gemini-call-${String(index)}`,
            name: fn.name,
            arguments: valid ? (args as Record<string, unknown>) : {},
            ...(valid ? {} : { argumentsError: 'arguments are not an object' }),
          });
        }
      });

      const usage = asRecord(body.usageMetadata ?? {}, 'gemini');
      return {
        text: texts.join(''),
        toolCalls,
        stopReason: stopReasonOf(first.finishReason, toolCalls.length > 0),
        usage: {
          inputTokens: tokenCount(usage.promptTokenCount),
          // Denk-Tokens werden wie Ausgabe berechnet und zaehlen mit.
          outputTokens:
            tokenCount(usage.candidatesTokenCount) + tokenCount(usage.thoughtsTokenCount),
        },
        raw: parts,
      };
    },

    async embed(request: EmbedRequest): Promise<EmbedResponse> {
      const vectors: number[][] = [];
      for (let start = 0; start < request.texts.length; start += EMBED_BATCH) {
        const batch = request.texts.slice(start, start + EMBED_BATCH);
        const payload = await postJson({
          provider: 'gemini',
          url: modelUrl(request.model, 'batchEmbedContents'),
          headers,
          body: {
            requests: batch.map((text) => ({
              model: `models/${geminiModelId(request.model)}`,
              content: { parts: [{ text }] },
              ...(request.dimensions === null ? {} : { outputDimensionality: request.dimensions }),
            })),
          },
          timeoutMs: options.timeoutMs ?? 60_000,
          secret: options.apiKey,
          fetch: doFetch,
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        });
        const body = asRecord(payload, 'gemini');
        const embeddings = Array.isArray(body.embeddings) ? body.embeddings : [];
        if (embeddings.length !== batch.length) {
          throw new ModelProviderError('gemini sent a different number of embeddings');
        }
        for (const embedding of embeddings) {
          vectors.push(asVector(asRecord(embedding, 'gemini').values, 'gemini'));
        }
      }
      // Die Embedding-API nennt keine Tokens; geschaetzt wie in `estimateTokens`.
      return { vectors, usage: { inputTokens: estimateTokens(request.texts), outputTokens: 0 } };
    },
  };
}
