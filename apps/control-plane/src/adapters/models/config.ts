/**
 * Modelle aus der Env (ADR 0024 A und C). Nur Env, kein Speicher.
 *
 * Chat und Embeddings je fuer sich:
 *
 * | Variable                           | Bedeutung                                   |
 * | ---------------------------------- | ------------------------------------------- |
 * | `OPENAPPS_CHAT_PROVIDER`           | `anthropic`, `gemini`, `openai-compatible`  |
 * | `OPENAPPS_CHAT_MODEL`              | Modellname, ohne Default                    |
 * | `OPENAPPS_CHAT_API_KEY`            | Schluessel; lokal (Ollama) nicht noetig     |
 * | `OPENAPPS_CHAT_BASE_URL`           | nur `openai-compatible`                     |
 * | `OPENAPPS_EMBEDDING_*`             | dasselbe fuer Embeddings (ohne `anthropic`) |
 * | `OPENAPPS_EMBEDDING_DIMENSIONS`    | optional, ganze Zahl                        |
 * | `OPENAPPS_MODEL_DAILY_TOKENS`      | Tagesgrenze der Installation               |
 * | `OPENAPPS_MODEL_DAILY_TOKENS_PER_SUBJECT` | Tagesgrenze je Subjekt              |
 * | `OPENAPPS_MODEL_LOCAL_ONLY_APPS`   | Apps, deren Inhalte im Haus bleiben (C2)    |
 *
 * **Ohne Konfiguration ist alles aus, und nichts bricht.** Fehlt etwas oder
 * passt etwas nicht, ist die Funktion `null` und `problems` sagt, welche
 * Variable, nie mit ihrem Wert. Die Control Plane startet in jedem Fall.
 *
 * Halb sicher ist nicht sicher: Laesst sich `OPENAPPS_MODEL_LOCAL_ONLY_APPS`
 * nicht lesen, sind alle **externen** Anbieter aus, damit kein Tippfehler
 * eine App nach aussen gibt. Eine externe Basis-URL muss `https` sein, damit
 * der Schluessel nicht im Klartext reist.
 */

import { MODEL_LIMIT_DEFAULTS } from '../../domain/models';
import { isLocalProvider } from '../../domain/model-locality';
import type {
  ConfiguredEmbeddingModel,
  ConfiguredModel,
  ModelLimits,
  ModelProvider,
  ModelProviderKind,
  ModelSetup,
} from '../../domain/ports';
import { createAnthropicProvider } from './anthropic';
import { createGeminiProvider } from './gemini';
import type { FetchLike } from './http';
import { createOpenAiCompatibleProvider, OPENAI_DEFAULT_BASE_URL } from './openai-compatible';

const PROVIDERS: readonly ModelProviderKind[] = ['anthropic', 'gemini', 'openai-compatible'];
const APP_NAME = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;
/** Hoechster Wert fuer eine Tagesgrenze: zehn Milliarden Tokens. */
const LIMIT_MAX = 10_000_000_000;
const MODEL_NAME_MAX = 200;

export interface ModelEnvOptions {
  /** Fuer Tests: gestellte HTTP-Antworten statt echter Aufrufe. */
  readonly fetch?: FetchLike;
}

/** Die Env als einfache Liste; `process.env` passt, ein Objekt in Tests auch. */
export type EnvSource = Readonly<Record<string, string | undefined>>;

interface Endpoint {
  readonly kind: ModelProviderKind;
  readonly model: string;
  readonly apiKey: string | null;
  readonly baseUrl: string | null;
  readonly local: boolean;
}

function value(env: EnvSource, key: string): string | undefined {
  const raw = env[key];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** Liest die vier Variablen eines Zwecks. `null` mit Problemen, wenn sie nicht passen. */
function readEndpoint(
  env: EnvSource,
  prefix: 'OPENAPPS_CHAT' | 'OPENAPPS_EMBEDDING',
  problems: string[],
): Endpoint | null {
  const providerName = value(env, `${prefix}_PROVIDER`);
  const model = value(env, `${prefix}_MODEL`);
  const apiKey = value(env, `${prefix}_API_KEY`) ?? null;
  const baseUrl = value(env, `${prefix}_BASE_URL`) ?? null;

  // Nichts gesetzt: aus, ohne Hinweis. Das ist der Normalfall ohne Modell.
  if (providerName === undefined && model === undefined && apiKey === null && baseUrl === null) {
    return null;
  }

  const before = problems.length;
  if (providerName === undefined) {
    problems.push(`${prefix}_PROVIDER is missing`);
  } else if (!PROVIDERS.includes(providerName as ModelProviderKind)) {
    problems.push(`${prefix}_PROVIDER must be one of ${PROVIDERS.join(', ')}`);
  }
  if (model === undefined) problems.push(`${prefix}_MODEL is missing`);
  else if (model.length > MODEL_NAME_MAX || /\s/.test(model)) {
    problems.push(`${prefix}_MODEL is not a model name`);
  }
  if (problems.length > before) return null;

  const kind = providerName as ModelProviderKind;
  if (kind !== 'openai-compatible' && baseUrl !== null) {
    problems.push(`${prefix}_BASE_URL is only used with openai-compatible`);
    return null;
  }

  let effectiveBase: string | null = null;
  if (kind === 'openai-compatible') {
    effectiveBase = baseUrl ?? OPENAI_DEFAULT_BASE_URL;
    let url: URL;
    try {
      url = new URL(effectiveBase);
    } catch {
      problems.push(`${prefix}_BASE_URL is not a URL`);
      return null;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      problems.push(`${prefix}_BASE_URL must be http or https`);
      return null;
    }
    if (url.username !== '' || url.password !== '') {
      // Zugangsdaten in der URL landeten in jeder Fehlermeldung von fetch.
      problems.push(`${prefix}_BASE_URL must not contain credentials`);
      return null;
    }
    if (url.search !== '' || url.hash !== '') {
      problems.push(`${prefix}_BASE_URL must not contain a query or fragment`);
      return null;
    }
  }

  const local = isLocalProvider(kind, effectiveBase);
  if (kind === 'openai-compatible' && !local && effectiveBase !== null) {
    if (new URL(effectiveBase).protocol !== 'https:') {
      problems.push(`${prefix}_BASE_URL must use https unless it is local`);
      return null;
    }
  }
  if (apiKey === null && !local) {
    problems.push(`${prefix}_API_KEY is missing`);
    return null;
  }

  return { kind, model: model as string, apiKey, baseUrl: effectiveBase, local };
}

function createProvider(endpoint: Endpoint, options: ModelEnvOptions): ModelProvider {
  const fetchOption = options.fetch === undefined ? {} : { fetch: options.fetch };
  if (endpoint.kind === 'anthropic') {
    return createAnthropicProvider({ apiKey: endpoint.apiKey ?? '', ...fetchOption });
  }
  if (endpoint.kind === 'gemini') {
    return createGeminiProvider({ apiKey: endpoint.apiKey ?? '', ...fetchOption });
  }
  return createOpenAiCompatibleProvider({
    baseUrl: endpoint.baseUrl ?? OPENAI_DEFAULT_BASE_URL,
    apiKey: endpoint.apiKey,
    local: endpoint.local,
    ...fetchOption,
  });
}

function readLimit(env: EnvSource, key: string, fallback: number, problems: string[]): number {
  const raw = value(env, key);
  if (raw === undefined) return fallback;
  const parsed = Number(raw.replaceAll('_', ''));
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > LIMIT_MAX) {
    // Ein unbrauchbarer Wert heisst nie „unbegrenzt“: Es gilt der Default.
    problems.push(
      `${key} must be a whole number from 1 to ${String(LIMIT_MAX)}; the default applies`,
    );
    return fallback;
  }
  return parsed;
}

function readLocalOnly(env: EnvSource, problems: string[]): { apps: string[]; valid: boolean } {
  const raw = value(env, 'OPENAPPS_MODEL_LOCAL_ONLY_APPS');
  if (raw === undefined) return { apps: [], valid: true };
  const entries = raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== '');
  const invalid = entries.filter((entry) => !APP_NAME.test(entry));
  if (invalid.length > 0) {
    problems.push(
      'OPENAPPS_MODEL_LOCAL_ONLY_APPS contains a value that is not an app name; external providers are off',
    );
  }
  return {
    apps: [...new Set(entries.filter((entry) => APP_NAME.test(entry)))].sort(),
    valid: invalid.length === 0,
  };
}

function readDimensions(env: EnvSource, problems: string[]): number | null | 'invalid' {
  const raw = value(env, 'OPENAPPS_EMBEDDING_DIMENSIONS');
  if (raw === undefined) return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 16_384) {
    problems.push('OPENAPPS_EMBEDDING_DIMENSIONS must be a whole number from 1 to 16384');
    return 'invalid';
  }
  return parsed;
}

/** Die Modelle dieser Installation. Wirft nie; was fehlt, steht in `problems`. */
export function modelSetupFromEnv(
  env: EnvSource = process.env,
  options: ModelEnvOptions = {},
): ModelSetup {
  const problems: string[] = [];
  const localOnly = readLocalOnly(env, problems);
  const limits: ModelLimits = {
    dailyTokens: readLimit(
      env,
      'OPENAPPS_MODEL_DAILY_TOKENS',
      MODEL_LIMIT_DEFAULTS.dailyTokens,
      problems,
    ),
    dailyTokensPerSubject: readLimit(
      env,
      'OPENAPPS_MODEL_DAILY_TOKENS_PER_SUBJECT',
      MODEL_LIMIT_DEFAULTS.dailyTokensPerSubject,
      problems,
    ),
  };

  let chat: ConfiguredModel | null = null;
  const chatEndpoint = readEndpoint(env, 'OPENAPPS_CHAT', problems);
  if (chatEndpoint !== null && (chatEndpoint.local || localOnly.valid)) {
    chat = { provider: createProvider(chatEndpoint, options), model: chatEndpoint.model };
  }

  let embedding: ConfiguredEmbeddingModel | null = null;
  const embeddingEndpoint = readEndpoint(env, 'OPENAPPS_EMBEDDING', problems);
  const dimensions = readDimensions(env, problems);
  if (embeddingEndpoint !== null && embeddingEndpoint.kind === 'anthropic') {
    problems.push('OPENAPPS_EMBEDDING_PROVIDER anthropic offers no embeddings');
  } else if (
    embeddingEndpoint !== null &&
    dimensions !== 'invalid' &&
    (embeddingEndpoint.local || localOnly.valid)
  ) {
    embedding = {
      provider: createProvider(embeddingEndpoint, options),
      model: embeddingEndpoint.model,
      dimensions,
    };
  }

  return { chat, embedding, limits, localOnlyApps: localOnly.apps, problems };
}
