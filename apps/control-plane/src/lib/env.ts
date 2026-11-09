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
  /**
   * Die eine Domain, unter der alle Apps liegen (ADR 0007). Fruehere Fassungen
   * hatten hier `APP_BASE_DOMAIN`, eine Basis fuer `<app>.<basis>`; unter
   * ADR 0007 gibt es keine App-Subdomain mehr, also auch keine Basis.
   */
  readonly appsDomain: string | undefined;
  /**
   * Master-Secret, aus dem pro App `OPENAPPS_AUTH_SECRET` abgeleitet wird
   * (ADR 0004: ein Secret pro App, nicht ein geteiltes fuer alle). Es geht
   * nie in eine App — die App bekommt nur ihr abgeleitetes Secret.
   */
  readonly authMasterSecret: string;
  /** Eigene Domain der Control Plane — fuer die oeffentlichen Ausnahmen (Spec 1.3). */
  readonly controlPlaneHost: string;
  readonly appDatabaseHost: string;
  readonly gitleaksBinary: string;
  readonly semgrepBinary: string;
  /**
   * Das eine Docker-Netz, in dem App und Gateway zusammen liegen (Spec Woche 1,
   * Abschnitt 3.3). Der Konfigurations-Lint blockiert jedes weitere Netz.
   */
  readonly gatewayNetwork: string;

  /* --- Die eigene dynamische Gateway-Konfiguration (ADR 0008) ------------- */

  /**
   * Verzeichnis, in das die Control Plane `openapps.yaml` schreibt — im
   * Container gemountet, auf dem Host `/data/coolify/proxy/dynamic`
   * (ADR 0008, `proxy.php:791`). Default ist der Pfad, den Coolifys
   * Proxy-Container selbst benutzt.
   */
  readonly gatewayDynamicDir: string;
  /**
   * Adresse, die Traefiks Forward-Auth pro Aufruf fragt: die Control Plane im
   * Gateway-Netz, nicht ihre oeffentliche URL — sonst liefe die Auth-Pruefung
   * durch die Auth-Pruefung.
   *
   * Hier steht **nicht** mehr der interne `authz`-Entrypoint der alten
   * Fassung: Entrypoints stehen statisch, und die statische Datei gehoert
   * Coolify. Damit faellt das 2-s-Timeout der Auth-Anfrage weg
   * (`GATEWAY_TIMEOUT_NOTE` in `domain/gateway-config.ts`).
   */
  readonly forwardAuthAddress: string;
  /** Das Deny-Backend, auf das der Catch-all zeigt (403 auf alles). */
  readonly denyBackendUrl: string;
  /**
   * Entrypoint-Name in Coolifys statischer Konfiguration. Coolify nennt ihn
   * `https` (nicht `websecure` wie unsere alte eigene Datei) — ein falscher
   * Name heisst: kein Router kommt hoch.
   */
  readonly gatewayEntryPoint: string;
  /**
   * Zertifikats-Resolver aus Coolifys statischer Konfiguration. Leer heisst:
   * TLS ohne Resolver (lokaler Lauf mit eigenem Zertifikat).
   */
  readonly gatewayCertResolver: string | null;
  /**
   * Adresse der Control Plane im Gateway-Netz, fuer ihren eigenen Router.
   * Fehlt sie, schreibt der Generator keinen Router fuer die Control Plane —
   * dann ist der Login ueber unsere Konfiguration nicht erreichbar.
   */
  readonly controlPlaneUrl: string | undefined;
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
    appsDomain: env.APPS_DOMAIN,
    authMasterSecret,
    controlPlaneHost: required(env, 'CONTROL_PLANE_HOST').trim().toLowerCase(),
    appDatabaseHost: required(env, 'APP_DATABASE_HOST'),
    gitleaksBinary: env.GITLEAKS_BINARY ?? 'gitleaks',
    semgrepBinary: env.SEMGREP_BINARY ?? 'semgrep',
    gatewayNetwork: env.GATEWAY_DOCKER_NETWORK ?? 'coolify',
    gatewayDynamicDir: env.GATEWAY_DYNAMIC_DIR ?? '/traefik/dynamic',
    forwardAuthAddress:
      env.FORWARD_AUTH_ADDRESS ?? 'http://openapps-control-plane:3000/api/authz/forward',
    denyBackendUrl: env.GATEWAY_DENY_BACKEND_URL ?? 'http://openapps-deny-backend:8080',
    gatewayEntryPoint: env.GATEWAY_ENTRYPOINT ?? 'https',
    gatewayCertResolver:
      env.GATEWAY_CERT_RESOLVER === undefined
        ? 'letsencrypt'
        : env.GATEWAY_CERT_RESOLVER.trim() === ''
          ? null
          : env.GATEWAY_CERT_RESOLVER.trim(),
    controlPlaneUrl: env.CONTROL_PLANE_SERVICE_URL,
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
