import { AppCallError, callAppTool } from '@openapps/sdk';

/**
 * Das Modell der Plattform, so wie Knowledge es sieht (ADR 0024 D, ADR 0025).
 *
 * Knowledge hat keinen eigenen Schluessel. Vektoren und Antworten kommen ueber
 * die Plattform-Tools `platform.embed` und `platform.generate`, als
 * `app:knowledge`, mit Freigabe, Tagesgrenze und Audit in der Control Plane.
 * `platform.model_info` sagt, welches Modell gilt und wie viel Budget heute
 * noch da ist, ohne ein Modell zu rufen.
 *
 * Kein Rechte-Code: Ob Knowledge das darf, entscheidet die Plattform. Hier
 * werden nur ihre Antworten in eine feste Form gebracht. Jeder Fehler wird
 * zu einem `status`; diese Schicht wirft nie, damit Suchen und Speichern nie
 * an einem fehlenden oder langsamen Anbieter scheitern.
 *
 * Inhalte gehen immer mit ihrer Quell-App hinaus (`sourceApp`). Daran haelt
 * die Plattform Inhalte aus `OPENAPPS_MODEL_LOCAL_ONLY_APPS` vor einem
 * externen Anbieter zurueck (`withheld`); Knowledge kennt die Liste nicht und
 * muss sie nicht kennen.
 */

/** Warum gerade kein Modell da ist. Fuer Status und Log, nie Text des Anbieters. */
export type ModelUnavailable =
  /** Kein Modell konfiguriert (503 `not_configured`). */
  | 'not_configured'
  /** Keine Freigabe fuer `app:knowledge` (403). */
  | 'denied'
  /** Tagesgrenze erreicht (429 `budget_exceeded`). */
  | 'budget_exceeded'
  /** `OPENAPPS_PLATFORM_URL` oder `OPENAPPS_CALL_SECRET` fehlen. */
  | 'no_platform'
  /** Plattform oder Anbieter antworten nicht oder mit einem Fehler. */
  | 'error';

export interface EmbeddingModelInfo {
  readonly provider: string;
  readonly model: string;
  readonly dimensions: number | null;
  readonly local: boolean;
}

export interface ChatModelInfo {
  readonly provider: string;
  readonly model: string;
  readonly local: boolean;
}

export interface ModelBudget {
  readonly resetsAt: string;
  readonly subject: { readonly limit: number; readonly used: number };
  readonly installation: { readonly limit: number; readonly used: number };
}

export type ModelInfo =
  | {
      readonly status: 'ok';
      readonly chat: ChatModelInfo | null;
      readonly embedding: EmbeddingModelInfo | null;
      readonly budget: ModelBudget | null;
    }
  | { readonly status: ModelUnavailable };

export interface SourcedText {
  readonly id: string;
  readonly sourceApp: string;
  readonly text: string;
}

export type EmbedOutcome =
  | {
      readonly status: 'ok';
      readonly model: EmbeddingModelInfo;
      readonly embeddings: readonly { readonly id: string; readonly vector: readonly number[] }[];
      /** Ids, die die Plattform nicht an den Anbieter gegeben hat. */
      readonly withheld: readonly string[];
    }
  | { readonly status: ModelUnavailable };

export interface GenerateRequest {
  readonly instruction: string;
  readonly contents: readonly SourcedText[];
  readonly maxTokens: number;
  /** Wer in Knowledge gefragt hat, nur fuer das Audit der Plattform. */
  readonly onBehalfOf: string | null;
}

export type GenerateOutcome =
  | {
      readonly status: 'ok';
      readonly text: string;
      readonly withheld: readonly string[];
    }
  /** Alles zurueckgehalten: Die Plattform hat kein Modell gefragt. */
  | { readonly status: 'withheld'; readonly withheld: readonly string[] }
  | { readonly status: ModelUnavailable };

export interface PlatformModels {
  info(): Promise<ModelInfo>;
  embed(
    texts: readonly SourcedText[],
    options?: { readonly timeoutMs?: number },
  ): Promise<EmbedOutcome>;
  generate(request: GenerateRequest): Promise<GenerateOutcome>;
}

/** Wie lange ein Aufruf hoechstens dauert. Die Suche wartet auf `embed` nur kurz. */
const INFO_TIMEOUT_MS = 3_000;
const EMBED_TIMEOUT_MS = 30_000;
const GENERATE_TIMEOUT_MS = 60_000;

/** Die Antwort der Plattform als Fehlerart. */
export function unavailableOf(error: unknown): ModelUnavailable {
  if (!(error instanceof AppCallError)) return 'error';
  if (error.code === 'not_configured') return 'no_platform';
  if (error.code === 'denied') return 'denied';
  const code =
    typeof error.body === 'object' && error.body !== null
      ? (error.body as Record<string, unknown>).error
      : undefined;
  if (error.status === 503 && code === 'not_configured') return 'not_configured';
  if (error.status === 429 && code === 'budget_exceeded') return 'budget_exceeded';
  return 'error';
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === 'string';

function embeddingInfoOf(value: unknown): EmbeddingModelInfo | null {
  if (!isRecord(value) || !isString(value.provider) || !isString(value.model)) return null;
  const dimensions =
    typeof value.dimensions === 'number' && Number.isInteger(value.dimensions)
      ? value.dimensions
      : null;
  return {
    provider: value.provider,
    model: value.model,
    dimensions,
    local: value.local === true,
  };
}

function chatInfoOf(value: unknown): ChatModelInfo | null {
  if (!isRecord(value) || !isString(value.provider) || !isString(value.model)) return null;
  return { provider: value.provider, model: value.model, local: value.local === true };
}

function budgetOf(value: unknown): ModelBudget | null {
  if (!isRecord(value) || !isString(value.resetsAt)) return null;
  const pair = (entry: unknown): { limit: number; used: number } | null =>
    isRecord(entry) && typeof entry.limit === 'number' && typeof entry.used === 'number'
      ? { limit: entry.limit, used: entry.used }
      : null;
  const subject = pair(value.subject);
  const installation = pair(value.installation);
  if (subject === null || installation === null) return null;
  return { resetsAt: value.resetsAt, subject, installation };
}

function idsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(isString) : [];
}

function vectorOf(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 16_000) return null;
  const vector: number[] = [];
  for (const entry of value) {
    if (typeof entry !== 'number' || !Number.isFinite(entry)) return null;
    vector.push(entry);
  }
  return vector;
}

/** Der Normalweg: ueber die Plattform (`callAppTool('platform', …)`). */
export const platformModels: PlatformModels = {
  async info() {
    try {
      const value = await callAppTool('platform', 'model_info', {}, { timeoutMs: INFO_TIMEOUT_MS });
      if (!isRecord(value)) return { status: 'error' };
      return {
        status: 'ok',
        chat: chatInfoOf(value.chat),
        embedding: embeddingInfoOf(value.embedding),
        budget: budgetOf(value.budget),
      };
    } catch (error) {
      return { status: unavailableOf(error) };
    }
  },

  async embed(texts, options) {
    try {
      const value = await callAppTool(
        'platform',
        'embed',
        { texts: texts.map((t) => ({ id: t.id, sourceApp: t.sourceApp, text: t.text })) },
        { timeoutMs: options?.timeoutMs ?? EMBED_TIMEOUT_MS },
      );
      if (!isRecord(value)) return { status: 'error' };
      const model = embeddingInfoOf(value.model);
      if (model === null) return { status: 'error' };
      const withheld = idsOf(value.withheld);
      const embeddings: { id: string; vector: number[] }[] = [];
      for (const entry of Array.isArray(value.embeddings) ? value.embeddings : []) {
        if (!isRecord(entry) || !isString(entry.id)) return { status: 'error' };
        const vector = vectorOf(entry.vector);
        if (vector === null) return { status: 'error' };
        embeddings.push({ id: entry.id, vector });
      }
      return { status: 'ok', model, embeddings, withheld };
    } catch (error) {
      return { status: unavailableOf(error) };
    }
  },

  async generate(request) {
    try {
      const value = await callAppTool(
        'platform',
        'generate',
        {
          instruction: request.instruction,
          contents: request.contents.map((c) => ({
            id: c.id,
            sourceApp: c.sourceApp,
            text: c.text,
          })),
          maxTokens: request.maxTokens,
          purpose: 'answer',
          ...(request.onBehalfOf === null ? {} : { onBehalfOf: request.onBehalfOf }),
        },
        { timeoutMs: GENERATE_TIMEOUT_MS },
      );
      if (!isRecord(value)) return { status: 'error' };
      const withheld = idsOf(value.withheld);
      if (value.status === 'withheld') return { status: 'withheld', withheld };
      if (value.status !== 'ok' || !isString(value.text)) return { status: 'error' };
      return { status: 'ok', text: value.text, withheld };
    } catch (error) {
      return { status: unavailableOf(error) };
    }
  },
};

let current: PlatformModels = platformModels;

/** Das Modell, das Knowledge gerade benutzt. */
export function models(): PlatformModels {
  return current;
}

/** Fuer Tests: ein gestelltes Modell einsetzen. `undefined` stellt den Normalweg her. */
export function setPlatformModels(replacement: PlatformModels | undefined): void {
  current = replacement ?? platformModels;
}

/** Die Kennung eines Embedding-Modells: Anbieter, Modell, Dimension (ADR 0025 B). */
export function modelKeyOf(
  model: Pick<EmbeddingModelInfo, 'provider' | 'model' | 'dimensions'>,
): string {
  return `${model.provider}/${model.model}/${model.dimensions === null ? 'auto' : String(model.dimensions)}`;
}
