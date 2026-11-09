/**
 * Alle Env-Variablen an einer Stelle, mit Pruefung beim ersten Zugriff.
 * Keine Default-Werte fuer Secrets — fehlt eines, startet die Control Plane
 * nicht, statt mit einer unsicheren Annahme weiterzulaufen.
 */

export interface ControlPlaneEnv {
  readonly databaseUrl: string;
  readonly baseDomain: string | undefined;
  readonly gatewaySigningSecret: string;
  readonly gatewaySignatureMaxAgeS: number;
  readonly forwardAuthUrl: string;
  readonly appDatabaseHost: string;
  readonly gitleaksBinary: string;
  readonly semgrepBinary: string;
}

export function readEnv(env: NodeJS.ProcessEnv = process.env): ControlPlaneEnv {
  return {
    databaseUrl: required(env, 'DATABASE_URL'),
    baseDomain: env.APP_BASE_DOMAIN,
    gatewaySigningSecret: required(env, 'GATEWAY_SIGNING_SECRET'),
    gatewaySignatureMaxAgeS: Number(env.GATEWAY_SIGNATURE_MAX_AGE_S ?? '120'),
    forwardAuthUrl: required(env, 'FORWARD_AUTH_URL'),
    appDatabaseHost: required(env, 'APP_DATABASE_HOST'),
    gitleaksBinary: env.GITLEAKS_BINARY ?? 'gitleaks',
    semgrepBinary: env.SEMGREP_BINARY ?? 'semgrep',
  };
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (value === undefined || value === '') {
    throw new Error(`Env-Variable ${key} fehlt`);
  }
  return value;
}
