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
   * Adresse, die Traefiks Forward-Auth-Middleware pro Aufruf fragt — die, die
   * in die App-Labels geht. Das ist **nicht** die oeffentliche URL der Control
   * Plane, sondern der interne `authz`-Entrypoint von Traefik selbst. Grund: `forwardAuth` hat keine Timeout-Option, ihr
   * HTTP-Client hat 30 s fest eingebaut; nur hinter dem Entrypoint greift der
   * `serversTransport` mit 2 s.
   */
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
    // Default und Gegenstueck: `entryPoints.authz.address` in
    // `infra/traefik/traefik.yml` (127.0.0.1:8090) plus der Router
    // `openapps-authz-forward` in `infra/traefik/dynamic/control-plane.yml`
    // (PathPrefix `/api/authz/forward`). Aendert sich eine der beiden Stellen,
    // muss die andere mit — deshalb ist der Wert hier eine Env und kein
    // Literal im Label-Code.
    forwardAuthUrl: env.FORWARD_AUTH_LABEL_URL ?? 'http://127.0.0.1:8090/api/authz/forward',
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
