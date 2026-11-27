/**
 * Adressen und Zugaenge des lokalen Stapels (infra/lokal, ADR 0011, 0013,
 * 0014). Alles hier liest nur, nichts aendert den Stapel.
 *
 * Das Token von `operator` liegt in `infra/lokal/.agents/operator.token`
 * (Modus 0600, angelegt von `apps-ausrollen.sh`). Es wird gelesen, an den MCP
 * geschickt und sonst nirgends hingeschrieben: nicht ins Log, nicht in einen
 * Fehlertext, nicht in einen Trace (Traces sind in der Konfiguration aus).
 */

import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** Wurzel des Repos. */
export const REPO_ROOT = join(here, '../../..');
export const LOKAL_DIR = join(REPO_ROOT, 'infra/lokal');
export const LOKAL_SH = join(LOKAL_DIR, 'lokal.sh');
const TOKEN_FILE = join(LOKAL_DIR, '.agents/operator.token');

/** Ansehen-Proxy der Apps, angemeldet als `viewer@local.test` (ADR 0013). */
export const VIEW_URL = process.env.E2E_VIEW_URL ?? 'http://127.0.0.1:8090';
/** Ansehen-Proxy der Verwaltung, Rolle per Cookie (ADR 0014). */
export const ADMIN_URL = process.env.E2E_ADMIN_URL ?? 'http://127.0.0.1:8091';
/** Plattform-MCP auf dem Loopback (traefik/lokal-mcp.yml). */
export const MCP_URL = process.env.E2E_MCP_URL ?? 'http://localhost:8080/mcp';

/**
 * Der echte Weg durch Traefik und Forward-Auth: `https://apps.local.test:8443`.
 * Chromium loest die Namen ueber `--host-resolver-rules` auf 127.0.0.1 auf
 * (playwright.config.ts), `/etc/hosts` bleibt unberuehrt.
 */
export const APPS_HOST = 'apps.local.test';
export const CP_HOST = 'cp.local.test';
export const GATEWAY_PORT = Number(process.env.E2E_GATEWAY_PORT ?? '8443');
export const GATEWAY_URL = `https://${APPS_HOST}:${String(GATEWAY_PORT)}`;

/** Die Identitaet, die der Ansehen-Proxy auf 8090 signiert (`ANSICHT_IDENTITY`). */
export const VIEWER_EMAIL = 'viewer@local.test';

/**
 * Liest das Token von `operator`. Der Fehlertext nennt nur die Datei, nie den
 * Inhalt.
 */
export function operatorToken(): string {
  let token: string;
  try {
    token = readFileSync(TOKEN_FILE, 'utf8').trim();
  } catch {
    throw new Error(
      `No operator token at ${TOKEN_FILE}. Run ./infra/lokal/apps-ausrollen.sh once first.`,
    );
  }
  if (token === '') throw new Error(`Operator token file ${TOKEN_FILE} is empty.`);
  return token;
}

/** Prueft, dass die Token-Datei nur fuer den Besitzer lesbar ist. */
export function operatorTokenModeOk(): boolean {
  try {
    return (statSync(TOKEN_FILE).mode & 0o077) === 0;
  } catch {
    return false;
  }
}

/**
 * Nur die zwei nicht geheimen Schluessel aus `infra/lokal/.env`. Die Datei
 * enthaelt auch Secrets; die werden nicht gelesen, nicht gespeichert.
 */
function lokalEnvValue(key: string): string | undefined {
  let text: string;
  try {
    text = readFileSync(join(LOKAL_DIR, '.env'), 'utf8');
  } catch {
    return undefined;
  }
  for (const line of text.split('\n')) {
    if (line.startsWith(`${key}=`)) return line.slice(key.length + 1).trim();
  }
  return undefined;
}

function firstListEntry(raw: string | undefined, fallback: string): string {
  const first = (raw ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .find((entry) => entry !== '');
  return first ?? fallback;
}

/**
 * Die Adressen der zwei Rollen auf 8091, wie `emailFuerRolle` sie bildet:
 * `admin` ist der erste Eintrag aus `AUTH_BOOTSTRAP_ADMINS`, `user` ist
 * `user@<erste erlaubte Domain>`. Defaults wie in docker-compose.yml.
 */
export function roleEmails(): { readonly admin: string; readonly user: string } {
  const admin = firstListEntry(
    process.env.AUTH_BOOTSTRAP_ADMINS ?? lokalEnvValue('AUTH_BOOTSTRAP_ADMINS'),
    'admin@example.com',
  );
  const domain = firstListEntry(
    process.env.AUTH_ALLOWED_EMAIL_DOMAINS ?? lokalEnvValue('AUTH_ALLOWED_EMAIL_DOMAINS'),
    'example.com',
  );
  return { admin, user: `user@${domain}` };
}
