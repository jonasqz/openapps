/**
 * Der eine HTTP-Weg aller Modell-Adapter. Zwei Regeln, die hier und nur hier
 * durchgesetzt werden:
 *
 * 1. **Der Schluessel steht nur in einem Header**, nie in der URL. Eine URL
 *    landet in Fehlermeldungen und Logs von `fetch`; ein Header nicht.
 * 2. **Keine Meldung des Anbieters nach aussen.** Manche Anbieter wiederholen
 *    im Fehlertext Teile des Schluessels („Incorrect API key provided:
 *    sk-…“). Weitergegeben werden nur Anbieter, HTTP-Status und eine
 *    Fehlerart aus einem festen Zeichensatz. Zur Sicherheit wird der
 *    Schluessel aus jeder Meldung entfernt, falls er doch hineingeriete.
 */

import { ModelProviderError } from '../../domain/errors';

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface PostJsonInput {
  readonly provider: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly timeoutMs: number;
  /** Wird aus jeder Meldung entfernt. */
  readonly secret: string | null;
  readonly fetch: FetchLike;
  readonly signal?: AbortSignal;
}

const ERROR_TYPE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

/** Die Fehlerart aus der Antwort, wenn sie in den festen Zeichensatz passt. */
function errorTypeOf(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as Record<string, unknown>;
  const error = record.error;
  const candidates: unknown[] = [];
  if (typeof error === 'object' && error !== null) {
    const inner = error as Record<string, unknown>;
    candidates.push(inner.type, inner.status, inner.code);
  }
  candidates.push(record.type);
  for (const value of candidates) {
    if (typeof value === 'string' && ERROR_TYPE.test(value) && value !== 'error') return value;
  }
  return null;
}

export function redact(text: string, secret: string | null): string {
  if (secret === null || secret === '') return text;
  return text.split(secret).join('[redacted]');
}

export async function postJson(input: PostJsonInput): Promise<unknown> {
  const timeout = AbortSignal.timeout(input.timeoutMs);
  const signal = input.signal === undefined ? timeout : AbortSignal.any([input.signal, timeout]);
  let response: Response;
  try {
    response = await input.fetch(input.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...input.headers },
      body: JSON.stringify(input.body),
      signal,
    });
  } catch (cause) {
    // Nur der Name der Ursache (TimeoutError, AbortError, TypeError), nie ihr Text.
    const name = cause instanceof Error && ERROR_TYPE.test(cause.name) ? cause.name : 'Error';
    throw new ModelProviderError(
      redact(`${input.provider} could not be reached (${name})`, input.secret),
    );
  }

  const text = await response.text().catch(() => '');
  let payload: unknown = null;
  try {
    payload = text === '' ? null : (JSON.parse(text) as unknown);
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const type = errorTypeOf(payload);
    throw new ModelProviderError(
      redact(
        `${input.provider} responded ${String(response.status)}${type === null ? '' : ` (${type})`}`,
        input.secret,
      ),
    );
  }
  if (payload === null) {
    throw new ModelProviderError(`${input.provider} sent a response that is not JSON`);
  }
  return payload;
}

/** Ein Objekt oder ein Fehler mit fester Meldung. */
export function asRecord(value: unknown, provider: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ModelProviderError(`${provider} sent an unexpected response`);
  }
  return value as Record<string, unknown>;
}

export function tokenCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
}

/** Ein Vektor aus endlichen Zahlen, oder ein Fehler. */
export function asVector(value: unknown, provider: string): number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ModelProviderError(`${provider} sent an embedding without values`);
  }
  for (const entry of value) {
    if (typeof entry !== 'number' || !Number.isFinite(entry)) {
      throw new ModelProviderError(`${provider} sent an embedding with invalid values`);
    }
  }
  return value as number[];
}

/** Grobe Schaetzung fuer Anbieter, die beim Einbetten keine Tokens nennen: vier Zeichen je Token. */
export function estimateTokens(texts: readonly string[]): number {
  return texts.reduce((sum, text) => sum + Math.ceil(text.length / 4), 0);
}
