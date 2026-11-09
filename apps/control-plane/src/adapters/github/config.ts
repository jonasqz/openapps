/**
 * Konfiguration des GitHub-Adapters. Alles aus Env, nichts im Code.
 *
 * Dieser Ordner ist der einzige Ort im Repo, an dem „GitHub" vorkommen darf.
 * Die Domaene kennt nur `RepositoryBackend`.
 */

export interface GitHubConfig {
  readonly apiBaseUrl: string;
  /**
   * Token mit Schreibrecht auf die Organisation. Welcher Typ und welcher
   * Umfang: siehe README. Der Adapter prueft den Umfang nicht — er meldet,
   * was GitHub antwortet.
   */
  readonly token: string;
  /** Organisation, in der die App-Repos entstehen. */
  readonly owner: string;
  /** Template-Repo, aus dem kopiert wird: `owner/name`. */
  readonly templateRepo: string;
  /** Neue Repos sind privat, solange nichts anderes gesagt ist. */
  readonly private: boolean;
  /** Tag, auf dem ein frisches Repo steht. */
  readonly initialTag: string;
  readonly requestTimeoutMs: number;
}

export function gitHubConfigFromEnv(env: NodeJS.ProcessEnv = process.env): GitHubConfig {
  return {
    apiBaseUrl: (env.GITHUB_API_BASE_URL ?? 'https://api.github.com').replace(/\/+$/, ''),
    token: required(env, 'GITHUB_TOKEN'),
    owner: required(env, 'GITHUB_OWNER'),
    templateRepo: required(env, 'GITHUB_TEMPLATE_REPO'),
    private: (env.GITHUB_REPO_PRIVATE ?? 'true') !== 'false',
    initialTag: env.GITHUB_INITIAL_TAG ?? 'v0.0.0',
    requestTimeoutMs: Number(env.GITHUB_TIMEOUT_MS ?? '30000'),
  };
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (value === undefined || value === '') {
    throw new Error(`Env-Variable ${key} fehlt`);
  }
  return value;
}
