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
  /** Adresse der Forward-Auth-Route, die Traefik pro Aufruf fragt. */
  readonly forwardAuthUrl: string;
  readonly requestTimeoutMs: number;
}

export function coolifyConfigFromEnv(env: NodeJS.ProcessEnv = process.env): CoolifyConfig {
  return {
    baseUrl: required(env, 'COOLIFY_BASE_URL').replace(/\/+$/, ''),
    apiToken: required(env, 'COOLIFY_API_TOKEN'),
    projectUuid: required(env, 'COOLIFY_PROJECT_UUID'),
    serverUuid: required(env, 'COOLIFY_SERVER_UUID'),
    environmentName: env.COOLIFY_ENVIRONMENT_NAME ?? 'production',
    forwardAuthUrl: required(env, 'FORWARD_AUTH_URL'),
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
