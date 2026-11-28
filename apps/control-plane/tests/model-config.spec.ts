/**
 * Modelle aus der Env (ADR 0024 A, C, C2). Riskant:
 *
 * - Ohne jede Env ist alles aus, ohne Hinweis, und nichts wirft.
 * - Halb konfiguriert ist aus, mit Hinweis, und der Hinweis traegt nie einen Wert.
 * - „Lokal“ ist nur `openai-compatible` mit Loopback, privater Adresse oder
 *   Namen ohne Punkt. Alles andere ist extern.
 * - Eine kaputte Liste lokaler Apps schaltet externe Anbieter ab.
 * - Ohne Env gelten die Default-Grenzen, nie „unbegrenzt“.
 */

import { describe, expect, it } from 'vitest';
import { modelSetupFromEnv, type FetchLike } from '../src/adapters/models';
import { isLocalBaseUrl, isLocalProvider, MODEL_LIMIT_DEFAULTS } from '../src/domain';

const KEY = 'sk-fake-config-aaaaaaaaaaaaaaaa';

const neverCalled: FetchLike = async () => {
  throw new Error('no provider must be called while reading the env');
};

describe('ohne Konfiguration', () => {
  it('ist Chat und Embedding aus, ohne Hinweis, mit den Default-Grenzen', () => {
    const setup = modelSetupFromEnv({}, { fetch: neverCalled });
    expect(setup.chat).toBeNull();
    expect(setup.embedding).toBeNull();
    expect(setup.problems).toEqual([]);
    expect(setup.localOnlyApps).toEqual([]);
    expect(setup.limits).toEqual({
      dailyTokens: MODEL_LIMIT_DEFAULTS.dailyTokens,
      dailyTokensPerSubject: MODEL_LIMIT_DEFAULTS.dailyTokensPerSubject,
    });
    expect(MODEL_LIMIT_DEFAULTS).toEqual({
      dailyTokens: 1_000_000,
      dailyTokensPerSubject: 200_000,
    });
  });

  it('leere Werte zaehlen wie fehlende', () => {
    const setup = modelSetupFromEnv({
      OPENAPPS_CHAT_PROVIDER: ' ',
      OPENAPPS_CHAT_MODEL: '',
      OPENAPPS_CHAT_API_KEY: '',
    });
    expect(setup.chat).toBeNull();
    expect(setup.problems).toEqual([]);
  });
});

describe('halb oder falsch konfiguriert', () => {
  it('ohne Modell aus, mit Hinweis ohne den Schluessel', () => {
    const setup = modelSetupFromEnv({
      OPENAPPS_CHAT_PROVIDER: 'anthropic',
      OPENAPPS_CHAT_API_KEY: KEY,
    });
    expect(setup.chat).toBeNull();
    expect(setup.problems).toEqual(['OPENAPPS_CHAT_MODEL is missing']);
    expect(JSON.stringify(setup.problems)).not.toContain(KEY);
  });

  it('ohne Schluessel bei externem Anbieter aus', () => {
    const setup = modelSetupFromEnv({
      OPENAPPS_CHAT_PROVIDER: 'gemini',
      OPENAPPS_CHAT_MODEL: 'gemini-test',
    });
    expect(setup.chat).toBeNull();
    expect(setup.problems).toEqual(['OPENAPPS_CHAT_API_KEY is missing']);
  });

  it('ein unbekannter Anbieter nennt die erlaubten, nicht den Wert', () => {
    const setup = modelSetupFromEnv({
      OPENAPPS_CHAT_PROVIDER: 'mystery-secret-provider',
      OPENAPPS_CHAT_MODEL: 'x',
      OPENAPPS_CHAT_API_KEY: KEY,
    });
    expect(setup.chat).toBeNull();
    expect(setup.problems[0]).toBe(
      'OPENAPPS_CHAT_PROVIDER must be one of anthropic, gemini, openai-compatible',
    );
    expect(setup.problems.join(' ')).not.toContain('mystery');
  });

  it('BASE_URL nur bei openai-compatible; extern nur https; keine Zugangsdaten in der URL', () => {
    expect(
      modelSetupFromEnv({
        OPENAPPS_CHAT_PROVIDER: 'anthropic',
        OPENAPPS_CHAT_MODEL: 'c',
        OPENAPPS_CHAT_API_KEY: KEY,
        OPENAPPS_CHAT_BASE_URL: 'https://proxy.example.com',
      }).problems,
    ).toEqual(['OPENAPPS_CHAT_BASE_URL is only used with openai-compatible']);
    expect(
      modelSetupFromEnv({
        OPENAPPS_CHAT_PROVIDER: 'openai-compatible',
        OPENAPPS_CHAT_MODEL: 'c',
        OPENAPPS_CHAT_API_KEY: KEY,
        OPENAPPS_CHAT_BASE_URL: 'http://llm.example.com/v1',
      }).problems,
    ).toEqual(['OPENAPPS_CHAT_BASE_URL must use https unless it is local']);
    const withCredentials = modelSetupFromEnv({
      OPENAPPS_CHAT_PROVIDER: 'openai-compatible',
      OPENAPPS_CHAT_MODEL: 'c',
      OPENAPPS_CHAT_BASE_URL: 'https://user:notreal@llm.example.com/v1',
    });
    expect(withCredentials.chat).toBeNull();
    expect(withCredentials.problems).toEqual([
      'OPENAPPS_CHAT_BASE_URL must not contain credentials',
    ]);
    expect(withCredentials.problems.join(' ')).not.toContain('notreal');
  });

  it('Anthropic bietet keine Embeddings', () => {
    const setup = modelSetupFromEnv({
      OPENAPPS_EMBEDDING_PROVIDER: 'anthropic',
      OPENAPPS_EMBEDDING_MODEL: 'x',
      OPENAPPS_EMBEDDING_API_KEY: KEY,
    });
    expect(setup.embedding).toBeNull();
    expect(setup.problems).toEqual(['OPENAPPS_EMBEDDING_PROVIDER anthropic offers no embeddings']);
  });

  it('unbrauchbare Grenzen: der Default gilt, nie unbegrenzt', () => {
    for (const value of ['0', '-5', 'unlimited', '1.5', '99999999999999999']) {
      const setup = modelSetupFromEnv({
        OPENAPPS_MODEL_DAILY_TOKENS: value,
        OPENAPPS_MODEL_DAILY_TOKENS_PER_SUBJECT: value,
      });
      expect(setup.limits).toEqual(MODEL_LIMIT_DEFAULTS);
      expect(setup.problems).toHaveLength(2);
    }
    expect(
      modelSetupFromEnv({
        OPENAPPS_MODEL_DAILY_TOKENS: '5_000_000',
        OPENAPPS_MODEL_DAILY_TOKENS_PER_SUBJECT: '50000',
      }).limits,
    ).toEqual({ dailyTokens: 5_000_000, dailyTokensPerSubject: 50_000 });
  });
});

describe('vollstaendig konfiguriert', () => {
  it('Chat mit Anthropic, Embeddings mit Gemini, getrennt', () => {
    const setup = modelSetupFromEnv({
      OPENAPPS_CHAT_PROVIDER: 'anthropic',
      OPENAPPS_CHAT_MODEL: 'claude-test',
      OPENAPPS_CHAT_API_KEY: KEY,
      OPENAPPS_EMBEDDING_PROVIDER: 'gemini',
      OPENAPPS_EMBEDDING_MODEL: 'gemini-embedding-test',
      OPENAPPS_EMBEDDING_API_KEY: KEY,
      OPENAPPS_EMBEDDING_DIMENSIONS: '768',
    });
    expect(setup.problems).toEqual([]);
    expect(setup.chat?.provider.kind).toBe('anthropic');
    expect(setup.chat?.provider.local).toBe(false);
    expect(setup.chat?.model).toBe('claude-test');
    expect(setup.embedding?.provider.kind).toBe('gemini');
    expect(setup.embedding?.dimensions).toBe(768);
    // Der Schluessel steckt im Adapter, nicht in dem, was die Domaene sieht.
    expect(JSON.stringify(setup)).not.toContain(KEY);
  });

  it('Ollama lokal ohne Schluessel', () => {
    const setup = modelSetupFromEnv({
      OPENAPPS_CHAT_PROVIDER: 'openai-compatible',
      OPENAPPS_CHAT_MODEL: 'llama-test',
      OPENAPPS_CHAT_BASE_URL: 'http://ollama:11434/v1',
    });
    expect(setup.problems).toEqual([]);
    expect(setup.chat?.provider.local).toBe(true);
  });

  it('openai-compatible ohne BASE_URL ist OpenAI selbst und extern', () => {
    const setup = modelSetupFromEnv({
      OPENAPPS_CHAT_PROVIDER: 'openai-compatible',
      OPENAPPS_CHAT_MODEL: 'gpt-test',
      OPENAPPS_CHAT_API_KEY: KEY,
    });
    expect(setup.chat?.provider.local).toBe(false);
  });
});

describe('OPENAPPS_MODEL_LOCAL_ONLY_APPS', () => {
  it('Default leer; Namen kleingeschrieben, ohne Doppel', () => {
    expect(modelSetupFromEnv({}).localOnlyApps).toEqual([]);
    expect(
      modelSetupFromEnv({ OPENAPPS_MODEL_LOCAL_ONLY_APPS: ' crm, HR-files ,crm' }).localOnlyApps,
    ).toEqual(['crm', 'hr-files']);
  });

  it('eine kaputte Liste schaltet externe Anbieter ab, lokale bleiben', () => {
    const external = modelSetupFromEnv({
      OPENAPPS_MODEL_LOCAL_ONLY_APPS: 'crm,c r m',
      OPENAPPS_CHAT_PROVIDER: 'anthropic',
      OPENAPPS_CHAT_MODEL: 'claude-test',
      OPENAPPS_CHAT_API_KEY: KEY,
    });
    expect(external.chat).toBeNull();
    expect(external.problems.join(' ')).toContain('external providers are off');
    const local = modelSetupFromEnv({
      OPENAPPS_MODEL_LOCAL_ONLY_APPS: 'crm,c r m',
      OPENAPPS_CHAT_PROVIDER: 'openai-compatible',
      OPENAPPS_CHAT_MODEL: 'llama-test',
      OPENAPPS_CHAT_BASE_URL: 'http://127.0.0.1:11434/v1',
    });
    expect(local.chat?.provider.local).toBe(true);
  });
});

describe('was lokal heisst', () => {
  it.each([
    'http://localhost:11434/v1',
    'http://127.0.0.1:11434/v1',
    'http://127.8.9.10/v1',
    'http://10.0.0.5:8000/v1',
    'http://172.16.0.1/v1',
    'http://172.31.255.255/v1',
    'http://192.168.1.20/v1',
    'http://[::1]:11434/v1',
    'http://[fd12:3456::1]/v1',
    'http://ollama:11434/v1',
    'https://llm-intern/v1',
    // Die URL normalisiert Schreibweisen von 127.0.0.1.
    'http://2130706433/v1',
    'http://0x7f.0.0.1/v1',
  ])('%s ist lokal', (url) => {
    expect(isLocalBaseUrl(url)).toBe(true);
  });

  it.each([
    'https://api.openai.com/v1',
    'https://ollama.intern.example.com/v1',
    'http://ollama./v1',
    'http://172.32.0.1/v1',
    'http://172.15.0.1/v1',
    'http://169.254.169.254/v1',
    'http://8.8.8.8/v1',
    'http://[2001:db8::1]/v1',
    'http://[::ffff:127.0.0.1]/v1',
    'ftp://ollama/v1',
    'not a url',
    '',
  ])('%s ist extern', (url) => {
    expect(isLocalBaseUrl(url)).toBe(false);
  });

  it('nur openai-compatible kann lokal sein', () => {
    expect(isLocalProvider('openai-compatible', 'http://ollama:11434/v1')).toBe(true);
    expect(isLocalProvider('anthropic', 'http://ollama:11434/v1')).toBe(false);
    expect(isLocalProvider('gemini', 'http://127.0.0.1')).toBe(false);
    expect(isLocalProvider('openai-compatible', null)).toBe(false);
  });
});
