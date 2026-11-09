/**
 * Alle Env-Variablen an einer Stelle, mit Pruefung beim ersten Zugriff.
 * Keine Default-Werte fuer Secrets — fehlt eines, startet die Control Plane
 * nicht, statt mit einer unsicheren Annahme weiterzulaufen.
 */

import { parseDomainList, parseEmailList } from './auth-policy';

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

/**
 * Env der Anmeldung. Absichtlich getrennt von `readEnv`: Better Auth laeuft nur
 * im Web-Prozess, und eine fehlende Google-Zugangsdaten-Variable soll nicht
 * jedes Skript blockieren, das die Control Plane importiert.
 *
 * Halb konfiguriert ist schlimmer als nicht konfiguriert: fehlt eine der vier
 * Pflicht-Variablen, wirft diese Funktion — und damit die Auth-Instanz beim
 * ersten Zugriff.
 */
export interface AuthEnv {
  readonly secret: string;
  readonly baseUrl: string;
  readonly googleClientId: string;
  readonly googleClientSecret: string;
  /**
   * Erlaubte E-Mail-Domains. **Leer heisst: keine Anmeldung**, nicht jede.
   * Ohne diese Zeile koennte sich jeder mit einem Google-Konto ein Konto auf
   * der Plattform anlegen.
   */
  readonly allowedEmailDomains: readonly string[];
  /**
   * Erst-Zugang: Diese Adressen landen beim Login in `platform-admins`, der
   * Gruppe mit dem Wildcard-Grant aus Migration 0006. Leer heisst: niemand
   * kommt an die Control Plane — lieber ausgesperrt als offen.
   */
  readonly bootstrapAdmins: readonly string[];
}

export function readAuthEnv(env: NodeJS.ProcessEnv = process.env): AuthEnv {
  const secret = required(env, 'BETTER_AUTH_SECRET');
  if (secret.length < MIN_MASTER_SECRET_LENGTH) {
    throw new Error(
      `BETTER_AUTH_SECRET ist kuerzer als ${String(MIN_MASTER_SECRET_LENGTH)} Zeichen`,
    );
  }

  return {
    secret,
    baseUrl: required(env, 'BETTER_AUTH_URL').trim().replace(/\/$/, ''),
    googleClientId: required(env, 'GOOGLE_CLIENT_ID'),
    googleClientSecret: required(env, 'GOOGLE_CLIENT_SECRET'),
    allowedEmailDomains: parseDomainList(env.AUTH_ALLOWED_EMAIL_DOMAINS),
    bootstrapAdmins: parseEmailList(env.AUTH_BOOTSTRAP_ADMINS),
  };
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (value === undefined || value === '') {
    throw new Error(`Env-Variable ${key} fehlt`);
  }
  return value;
}
