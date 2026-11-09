/**
 * Alle Env-Variablen an einer Stelle, mit Pruefung beim ersten Zugriff.
 * Keine Default-Werte fuer Secrets — fehlt eines, startet die Control Plane
 * nicht, statt mit einer unsicheren Annahme weiterzulaufen.
 */

/** Mindestlaenge des Master-Secrets. Daraus wird pro App ein HMAC-Schluessel. */
const MIN_MASTER_SECRET_LENGTH = 32;

export interface ControlPlaneEnv {
  readonly databaseUrl: string;
  readonly baseDomain: string | undefined;
  /**
   * Master-Secret, aus dem pro App `OPENAPPS_AUTH_SECRET` abgeleitet wird
   * (ADR 0004: ein Secret pro App, nicht ein geteiltes fuer alle). Es geht
   * nie in eine App — die App bekommt nur ihr abgeleitetes Secret.
   */
  readonly authMasterSecret: string;
  readonly forwardAuthUrl: string;
  /** Eigene Domain der Control Plane — fuer die oeffentlichen Ausnahmen (Spec 1.3). */
  readonly controlPlaneHost: string;
  readonly appDatabaseHost: string;
  readonly gitleaksBinary: string;
  readonly semgrepBinary: string;
}

export function readEnv(env: NodeJS.ProcessEnv = process.env): ControlPlaneEnv {
  const authMasterSecret = required(env, 'OPENAPPS_AUTH_MASTER_SECRET');
  if (authMasterSecret.length < MIN_MASTER_SECRET_LENGTH) {
    throw new Error(
      `OPENAPPS_AUTH_MASTER_SECRET ist kuerzer als ${String(MIN_MASTER_SECRET_LENGTH)} Zeichen`,
    );
  }

  return {
    databaseUrl: required(env, 'DATABASE_URL'),
    baseDomain: env.APP_BASE_DOMAIN,
    authMasterSecret,
    forwardAuthUrl: required(env, 'FORWARD_AUTH_URL'),
    controlPlaneHost: required(env, 'CONTROL_PLANE_HOST').trim().toLowerCase(),
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
