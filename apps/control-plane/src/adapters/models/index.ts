/**
 * Modell-Anbieter (ADR 0024 A). Nach dem Muster des Coolify-Adapters: Der
 * Port `ModelProvider` steht in `domain/ports.ts`, hier stehen nur die
 * Adapter je Anbieter und das Lesen der Env. Kein Anbietername sickert in die
 * Domaene; sie kennt `kind` und `local`, sonst nichts.
 */

export { createAnthropicProvider, ANTHROPIC_MESSAGES_URL, ANTHROPIC_VERSION } from './anthropic';
export { createGeminiProvider, GEMINI_API_BASE, geminiModelId } from './gemini';
export { createOpenAiCompatibleProvider, OPENAI_DEFAULT_BASE_URL } from './openai-compatible';
export { modelSetupFromEnv, type EnvSource, type ModelEnvOptions } from './config';
export type { FetchLike } from './http';
