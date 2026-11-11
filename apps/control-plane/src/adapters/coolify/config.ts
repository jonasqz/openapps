/**
 * Konfiguration des Coolify-Adapters. Alles aus Env, nichts im Code.
 *
 * Diese Datei und ihre Nachbarn sind der einzige Ort im Repo, an dem das Wort
 * "Coolify" vorkommen darf. Die Domaene kennt nur `DeploymentBackend`.
 */

export interface CoolifyConfig {
  readonly baseUrl: string;
  readonly apiToken: string;
  /** Coolify-Projekt, unter dem alle Apps dieser Instanz haengen. */
  readonly projectUuid: string;
  readonly serverUuid: string;
  readonly environmentName: string;
  /**
   * Die in Coolify verbundene GitHub-App, ueber die private App-Repos geklont
   * werden. Fehlt sie, gehen nur oeffentliche Repos.
   */
  readonly githubAppUuid?: string;
  /** Zweig, den Coolify klont. Gebaut wird immer ein festgenagelter Commit. */
  readonly gitBranch: string;
  readonly requestTimeoutMs: number;
}

export function coolifyConfigFromEnv(env: NodeJS.ProcessEnv = process.env): CoolifyConfig {
  return {
    baseUrl: required(env, 'COOLIFY_BASE_URL').replace(/\/+$/, ''),
    apiToken: required(env, 'COOLIFY_API_TOKEN'),
    projectUuid: required(env, 'COOLIFY_PROJECT_UUID'),
    serverUuid: required(env, 'COOLIFY_SERVER_UUID'),
    environmentName: env.COOLIFY_ENVIRONMENT_NAME ?? 'production',
    ...(env.COOLIFY_GITHUB_APP_UUID === undefined || env.COOLIFY_GITHUB_APP_UUID === ''
      ? {}
      : { githubAppUuid: env.COOLIFY_GITHUB_APP_UUID }),
    gitBranch:
      env.COOLIFY_GIT_BRANCH === undefined || env.COOLIFY_GIT_BRANCH === ''
        ? 'main'
        : env.COOLIFY_GIT_BRANCH,
    requestTimeoutMs: Number(env.COOLIFY_TIMEOUT_MS ?? '30000'),
  };
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (value === undefined || value === '') {
    throw new Error(`Env-Variable ${key} fehlt`);
  }
  return value;
}
