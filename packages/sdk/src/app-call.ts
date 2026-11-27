import { createHash, createHmac } from 'node:crypto';
import { SdkError } from './errors.js';
import { APP_ID_ENV, MIN_SECRET_LENGTH } from './gateway.js';

/**
 * Eine App ruft das Tool einer anderen App (ADR 0020).
 *
 * Der Aufruf geht an die Control Plane, nicht an die Ziel-App:
 * `POST <OPENAPPS_PLATFORM_URL>/api/apps/<app>/tools/<tool>`. Die Control
 * Plane prueft die Signatur dieser App, die Freigabe `execute` auf
 * `<app>.<tool>` (Default-Deny), schreibt das Audit-Log und leitet weiter. Die
 * Ziel-App sieht den Aufrufer als `app:<name>` (`callerOf`).
 *
 * Zugangsdaten sind die der App selbst: `OPENAPPS_CALL_SECRET`, von der
 * Control Plane pro App abgeleitet. Kein Nutzer-Cookie, kein Token eines
 * Menschen oder Agenten. Dieses Modul gibt das Secret nie aus, weder in
 * Fehlermeldungen noch im Log.
 */

export const CALLER_HEADER = 'X-OpenApps-Caller';
export const CALLER_ISSUED_AT_HEADER = 'X-OpenApps-Caller-Issued-At';
export const CALLER_SIGNATURE_HEADER = 'X-OpenApps-Caller-Signature';

/** Adresse der Control Plane im Netz der Plattform, z. B. `http://openapps-control-plane:3000`. */
export const PLATFORM_URL_ENV = 'OPENAPPS_PLATFORM_URL';
/** Secret, mit dem die App ihre ausgehenden Aufrufe signiert. */
export const CALL_SECRET_ENV = 'OPENAPPS_CALL_SECRET';

export const APP_CALL_SIGNATURE_MATERIAL_VERSION = 'openapps-app-call-v1';

/** Gueltigkeit einer Aufruf-Signatur in Sekunden, wie die Identitaet (ADR 0004). */
export const APP_CALL_MAX_AGE_SECONDS = 60;

export const APP_CALL_DEFAULT_TIMEOUT_MS = 10_000;

/** Hoechstgroesse des Bodys, wie `createToolRoute` ihn annimmt. */
export const APP_CALL_MAX_BODY_BYTES = 1024 * 1024;

const APP_NAME = /^[a-z][a-z0-9-]{0,63}$/;
const TOOL_NAME = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export interface AppCallSignatureInput {
  readonly secret: string;
  /** Name der aufrufenden App. */
  readonly caller: string;
  /** Name der Ziel-App. */
  readonly app: string;
  readonly tool: string;
  /** Unix-Sekunden, als Zeichenkette. */
  readonly issuedAt: string;
  /** SHA-256 (Hex) des Bodys, so wie er gesendet wird. */
  readonly bodySha256: string;
}

export function appCallSignatureMaterial(input: Omit<AppCallSignatureInput, 'secret'>): string {
  return [
    APP_CALL_SIGNATURE_MATERIAL_VERSION,
    input.caller,
    input.app,
    input.tool,
    input.issuedAt,
    input.bodySha256,
  ].join('\n');
}

/** HMAC-SHA256 ueber das Material, Hex. Dieselbe Funktion fuer App und Control Plane. */
export function appCallSignatureFor(input: AppCallSignatureInput): string {
  return createHmac('sha256', input.secret)
    .update(appCallSignatureMaterial(input), 'utf8')
    .digest('hex');
}

export function sha256Hex(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

/**
 * Was beim Aufruf schiefging. `code` ist fuer Programme, `message` fuer
 * Menschen und Agents; beide enthalten nie ein Secret.
 *
 * - `not_configured` — Env fehlt oder ist unbrauchbar. Kein Aufruf ging raus.
 * - `invalid_target` — App- oder Tool-Name hat nicht die Form der Plattform.
 * - `unreachable`    — die Control Plane antwortete nicht.
 * - `timeout`        — keine Antwort im Zeitlimit.
 * - `unauthorized`   — die Plattform hat die Signatur abgewiesen (401).
 * - `denied`         — keine Freigabe auf das Tool (403).
 * - `invalid`        — die Ziel-App lehnt die Argumente ab (400).
 * - `not_found`      — die Ziel-App kennt das Gesuchte nicht (404).
 * - `target_error`   — jeder andere Fehler der Plattform oder der Ziel-App.
 */
export type AppCallErrorCode =
  | 'not_configured'
  | 'invalid_target'
  | 'unreachable'
  | 'timeout'
  | 'unauthorized'
  | 'denied'
  | 'invalid'
  | 'not_found'
  | 'target_error';

export class AppCallError extends SdkError {
  readonly code: AppCallErrorCode;
  /** Antwort der Plattform bzw. der Ziel-App, falls es eine gab. */
  readonly body: unknown;

  constructor(code: AppCallErrorCode, message: string, status: number, body: unknown = null) {
    super(message, status);
    this.code = code;
    this.body = body;
  }

  /** Lohnt ein spaeterer Versuch? Nein bei falschen Argumenten und falscher Form. */
  get retryable(): boolean {
    return this.code !== 'invalid' && this.code !== 'invalid_target';
  }
}

export interface CallAppToolOptions {
  /** Default: `process.env.OPENAPPS_PLATFORM_URL`. */
  readonly platformUrl?: string | undefined;
  /** Default: `process.env.OPENAPPS_CALL_SECRET`. */
  readonly secret?: string | undefined;
  /** Name dieser App. Default: `process.env.OPENAPPS_APP_ID`. */
  readonly caller?: string | undefined;
  /** Default 10 000 ms. */
  readonly timeoutMs?: number | undefined;
  /** Uhr in Millisekunden. Fuer Tests. */
  readonly now?: (() => number) | undefined;
  /** Fuer Tests. Default: das globale `fetch`. */
  readonly fetch?: typeof fetch | undefined;
}

/**
 * Ruft `tool` der App `app` mit `args` auf und gibt das Ergebnis der Ziel-App
 * zurueck (JSON). Wirft `AppCallError` mit einem `code`, nie mit einem Secret.
 *
 * ```ts
 * await callAppTool('knowledge', 'documents.upsert', { key, title, content });
 * ```
 */
export async function callAppTool(
  app: string,
  tool: string,
  args: Readonly<Record<string, unknown>> = {},
  options: CallAppToolOptions = {},
): Promise<unknown> {
  if (!APP_NAME.test(app) || !TOOL_NAME.test(tool)) {
    throw new AppCallError('invalid_target', `"${app}.${tool}" is not a valid app tool name`, 400);
  }
  const config = callConfig(options);

  const body = JSON.stringify(args);
  if (Buffer.byteLength(body, 'utf8') > APP_CALL_MAX_BODY_BYTES) {
    throw new AppCallError(
      'invalid',
      `arguments are larger than ${String(APP_CALL_MAX_BODY_BYTES)} bytes`,
      400,
    );
  }
  const issuedAt = String(Math.floor(config.now() / 1000));
  const signature = appCallSignatureFor({
    secret: config.secret,
    caller: config.caller,
    app,
    tool,
    issuedAt,
    bodySha256: sha256Hex(body),
  });

  const url = `${config.platformUrl}/api/apps/${app}/tools/${encodeURIComponent(tool)}`;
  let response: Response;
  try {
    response = await config.fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [CALLER_HEADER]: config.caller,
        [CALLER_ISSUED_AT_HEADER]: issuedAt,
        [CALLER_SIGNATURE_HEADER]: signature,
      },
      body,
      signal: AbortSignal.timeout(config.timeoutMs),
      redirect: 'manual',
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new AppCallError(
        'timeout',
        `${app}.${tool}: no answer within ${String(config.timeoutMs)} ms`,
        504,
      );
    }
    // Keine Fehlermeldung von fetch weitergeben: Sie kann die Adresse samt
    // Zugangsdaten enthalten, falls jemand sie in die URL geschrieben hat.
    throw new AppCallError('unreachable', `${app}.${tool}: the platform is not reachable`, 502);
  }

  const payload = await readJson(response);
  if (response.ok) return payload;

  const message = `${app}.${tool}: ${messageOf(payload) ?? `the platform answered ${String(response.status)}`}`;
  throw new AppCallError(codeFor(response.status), message, response.status, payload);
}

interface CallConfig {
  readonly platformUrl: string;
  readonly secret: string;
  readonly caller: string;
  readonly timeoutMs: number;
  readonly now: () => number;
  readonly fetch: typeof fetch;
}

function callConfig(options: CallAppToolOptions): CallConfig {
  const rawUrl = (options.platformUrl ?? process.env[PLATFORM_URL_ENV] ?? '').trim();
  if (rawUrl === '') {
    throw new AppCallError('not_configured', `${PLATFORM_URL_ENV} is not set`, 500);
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AppCallError('not_configured', `${PLATFORM_URL_ENV} is not a URL`, 500);
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
    throw new AppCallError(
      'not_configured',
      `${PLATFORM_URL_ENV} must be an http(s) address without credentials`,
      500,
    );
  }

  const secret = (options.secret ?? process.env[CALL_SECRET_ENV] ?? '').trim();
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new AppCallError(
      'not_configured',
      `${CALL_SECRET_ENV} is not set or shorter than ${String(MIN_SECRET_LENGTH)} characters`,
      500,
    );
  }

  const caller = (options.caller ?? process.env[APP_ID_ENV] ?? '').trim();
  if (!APP_NAME.test(caller)) {
    throw new AppCallError('not_configured', `${APP_ID_ENV} is not set or not an app name`, 500);
  }

  const timeoutMs = options.timeoutMs ?? APP_CALL_DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new AppCallError('not_configured', 'timeoutMs must be a positive number', 500);
  }

  return {
    platformUrl: `${url.origin}${url.pathname.replace(/\/+$/, '')}`,
    secret,
    caller,
    timeoutMs,
    now: options.now ?? Date.now,
    fetch: options.fetch ?? fetch,
  };
}

function codeFor(status: number): AppCallErrorCode {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'denied';
  if (status === 400) return 'invalid';
  if (status === 404) return 'not_found';
  return 'target_error';
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => '');
  if (text.trim() === '') return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function messageOf(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const record = payload as Record<string, unknown>;
  const message = typeof record.message === 'string' ? record.message : undefined;
  const error = typeof record.error === 'string' ? record.error : undefined;
  const text = message ?? error;
  return text === undefined ? undefined : text.slice(0, 500);
}
