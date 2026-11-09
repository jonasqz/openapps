/**
 * Startup-Check gegen die Traefik-API: Haengt der Schutz noch am Entrypoint?
 *
 * Warum es diesen Check gibt (Spec `docs/specs/woche-1-forward-auth.md`,
 * Abschnitt 2, Zeile „Coolify-Update ueberschreibt die statische
 * Traefik-Konfiguration"): Die Forward-Auth haengt an
 * `entryPoints.websecure.http.middlewares`. Ein Coolify-Update kann diese
 * Datei ersetzen. Dann faellt der Schutz weg, ohne dass irgendwo ein Fehler
 * entsteht — jede App waere offen und niemand wuesste es. Also fragt die
 * Control Plane beim Start die laufende Traefik-Instanz, ob die Konfiguration
 * noch die ist, die `infra/traefik/` beschreibt.
 *
 * Der Check prueft drei Dinge, und alle drei sind Alarm, kein Hinweis:
 *
 *  1. Die Middleware-Kette am `websecure`-Entrypoint ist **genau**
 *     `[strip, forward-auth]`. Fehlt die Forward-Auth, ist der Schutz weg.
 *     Fehlt `strip` oder steht sie hinter der Auth, kann ein Client seine
 *     eigenen `X-Auth-*`-Header mitschicken (ADR 0004) — die Reihenfolge ist
 *     Teil der Sicherheit, nicht Kosmetik.
 *  2. `forwardedHeaders` am Entrypoint ist leer. Steht dort `insecure: true`
 *     oder eine weite `trustedIPs`-Liste, bestimmt der Aufrufer
 *     `X-Forwarded-Host` — und damit die Pfad-Allowlist aus Spec 1.3, die
 *     genau diesem Header vertraut.
 *  3. Der Catch-all-Router `openapps-catch-all@file` existiert und ist
 *     `enabled`. Ohne ihn landet eine Domain ohne eigenen Router nicht beim
 *     Deny-Backend.
 */

/** Entrypoint, an dem der Schutz haengt. */
export const GUARDED_ENTRYPOINT = 'websecure';

/**
 * Die Kette in genau dieser Reihenfolge — Gegenstueck zu
 * `entryPoints.websecure.http.middlewares` in `infra/traefik/traefik.yml`.
 */
export const REQUIRED_ENTRYPOINT_MIDDLEWARES: readonly string[] = [
  'openapps-strip-auth-headers@file',
  'openapps-forward-auth@file',
];

/** Gegenstueck zum Router in `infra/traefik/dynamic/catch-all.yml`. */
export const REQUIRED_CATCH_ALL_ROUTER = 'openapps-catch-all@file';

/**
 * Drei Zustaende, nicht zwei. Der Unterschied ist der ganze Zweck dieser
 * Unterscheidung: „Ich habe nichts erfahren" (`unreachable`) ist kein Befund
 * ueber die Konfiguration, „die Kette ist falsch" (`alarm`) ist einer.
 */
export type GatewayGuardResult =
  | { readonly state: 'ok' }
  | { readonly state: 'unreachable'; readonly reason: string }
  | { readonly state: 'alarm'; readonly problems: readonly string[] };

export interface GatewayGuardOptions {
  /** Default `http://traefik:8080` bzw. `TRAEFIK_API_URL`. */
  readonly apiUrl?: string;
  /** HTTP-Zugang. In den Tests ein Double, im Betrieb `globalThis.fetch`. */
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
}

const DEFAULT_API_URL = 'http://traefik:8080';
const DEFAULT_TIMEOUT_MS = 3000;

export function traefikApiUrl(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const raw = env.TRAEFIK_API_URL;
  return (raw === undefined || raw.trim() === '' ? DEFAULT_API_URL : raw.trim()).replace(
    /\/+$/,
    '',
  );
}

export async function checkGatewayProtection(
  options: GatewayGuardOptions = {},
): Promise<GatewayGuardResult> {
  const base = (options.apiUrl ?? traefikApiUrl()).replace(/\/+$/, '');
  const http = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const entrypoints = await getJson(http, `${base}/api/entrypoints`, timeoutMs);
  if (!entrypoints.ok) return { state: 'unreachable', reason: entrypoints.reason };

  const routers = await getJson(http, `${base}/api/http/routers`, timeoutMs);
  if (!routers.ok) return { state: 'unreachable', reason: routers.reason };

  // Keine Liste heisst: Das ist keine Traefik-API. Dann wissen wir nichts
  // ueber die Konfiguration — also `unreachable` und nicht Alarm. Ein Alarm
  // hier wuerde bei einer falsch gesetzten `TRAEFIK_API_URL` losgehen und
  // damit genau das Signal abstumpfen, das bei einem echten Verlust des
  // Schutzes zaehlt.
  if (!Array.isArray(entrypoints.value)) {
    return { state: 'unreachable', reason: '/api/entrypoints liefert keine Liste' };
  }
  if (!Array.isArray(routers.value)) {
    return { state: 'unreachable', reason: '/api/http/routers liefert keine Liste' };
  }

  const problems: string[] = [];
  const entrypoint = entrypoints.value
    .filter(isRecord)
    .find((entry) => entry.name === GUARDED_ENTRYPOINT);

  if (entrypoint === undefined) {
    // Hier wissen wir etwas: Die Antwort ist verwertbar und der Entrypoint,
    // an dem der Schutz haengt, kommt darin nicht vor.
    problems.push(`Entrypoint "${GUARDED_ENTRYPOINT}" gibt es nicht`);
  } else {
    problems.push(...middlewareProblems(entrypoint), ...forwardedHeadersProblems(entrypoint));
  }

  problems.push(...catchAllProblems(routers.value));

  return problems.length === 0 ? { state: 'ok' } : { state: 'alarm', problems };
}

function middlewareProblems(entrypoint: Record<string, unknown>): readonly string[] {
  const http = isRecord(entrypoint.http) ? entrypoint.http : undefined;
  const actual = http === undefined ? undefined : http.middlewares;
  const chain = Array.isArray(actual) ? actual.map((item) => String(item)) : [];

  if (
    chain.length === REQUIRED_ENTRYPOINT_MIDDLEWARES.length &&
    chain.every((name, index) => name === REQUIRED_ENTRYPOINT_MIDDLEWARES[index])
  ) {
    return [];
  }
  return [
    `Middleware-Kette am Entrypoint "${GUARDED_ENTRYPOINT}" ist [${chain.join(', ')}], ` +
      `erwartet [${REQUIRED_ENTRYPOINT_MIDDLEWARES.join(', ')}] in genau dieser Reihenfolge`,
  ];
}

function forwardedHeadersProblems(entrypoint: Record<string, unknown>): readonly string[] {
  const forwarded = entrypoint.forwardedHeaders;
  if (forwarded === undefined || forwarded === null) return [];
  if (!isRecord(forwarded)) {
    return [`forwardedHeaders am Entrypoint "${GUARDED_ENTRYPOINT}" hat eine unbekannte Form`];
  }
  const keys = Object.keys(forwarded).filter((key) => {
    const value = forwarded[key];
    if (value === null || value === undefined || value === false) return false;
    return !(Array.isArray(value) && value.length === 0);
  });
  if (keys.length === 0) return [];
  return [
    `forwardedHeaders am Entrypoint "${GUARDED_ENTRYPOINT}" ist nicht leer (${keys.join(', ')}) — ` +
      'ein Client koennte X-Forwarded-Host setzen und damit die Pfad-Allowlist aus Spec 1.3 erschleichen',
  ];
}

function catchAllProblems(routers: readonly unknown[]): readonly string[] {
  const router = routers.filter(isRecord).find((entry) => entry.name === REQUIRED_CATCH_ALL_ROUTER);
  if (router === undefined) {
    return [`Catch-all-Router "${REQUIRED_CATCH_ALL_ROUTER}" fehlt`];
  }
  if (router.status !== 'enabled') {
    return [
      `Catch-all-Router "${REQUIRED_CATCH_ALL_ROUTER}" hat status "${String(router.status)}", erwartet "enabled"`,
    ];
  }
  return [];
}

type JsonResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: string };

async function getJson(
  http: typeof globalThis.fetch,
  url: string,
  timeoutMs: number,
): Promise<JsonResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await http(url, { signal: controller.signal, redirect: 'manual' });
    if (!response.ok) {
      return { ok: false, reason: `${url} antwortet ${String(response.status)}` };
    }
    const text = await response.text();
    try {
      return { ok: true, value: JSON.parse(text) as unknown };
    } catch {
      return { ok: false, reason: `${url} antwortet kein JSON` };
    }
  } catch (cause) {
    return { ok: false, reason: `${url} nicht erreichbar: ${errorText(cause)}` };
  } finally {
    clearTimeout(timer);
  }
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/* -------------------------------------------------------------------------- */
/* Alarmzustand des Prozesses                                                  */
/* -------------------------------------------------------------------------- */

let alarm: readonly string[] | undefined;

/** Die offenen Befunde des letzten Checks, oder `undefined`. */
export function gatewayAlarm(): readonly string[] | undefined {
  return alarm;
}

/** Nur fuer Tests: Zustand zuruecksetzen. */
export function resetGatewayAlarm(): void {
  alarm = undefined;
}

/**
 * Was bei Alarm passiert — und warum es nicht mehr ist.
 *
 * Entscheidung: laut protokollieren, den Zustand im Prozess merken und ihn in
 * `/healthz` sichtbar machen. **Kein** `process.exit`, und **kein** 503 auf
 * `/healthz`.
 *
 * Begruendung: Beides wuerde den Schaden vergroessern, statt ihn zu beheben.
 * Stirbt die Control Plane (oder laesst der Orchestrator sie wegen eines roten
 * Healthchecks neu starten), antwortet die Forward-Auth niemandem mehr — und
 * dann sperrt Traefik **alle** Domains, auch den Login, auch die Oberflaeche,
 * ueber die die Konfiguration wieder ausgerollt wird (Nachweis Fall 7: Control
 * Plane gestoppt → 502 fuer alles). Der gefaehrliche Zustand ist aber genau
 * umgekehrt: Der Schutz fehlt, die Apps sind offen, und jemand muss
 * `infra/traefik/` zurueckrollen. Dazu braucht er eine laufende Control Plane.
 *
 * Die Unterscheidung zur unerreichbaren API: `unreachable` ist eine Warnung
 * ohne Alarmzustand. Eine API, die nicht antwortet, ist kein Befund darueber,
 * ob die Middleware haengt — die Apps koennen voellig geschuetzt sein. Wer
 * daraus einen Alarm macht, hat nach der ersten falschen `TRAEFIK_API_URL`
 * einen Alarm, den niemand mehr liest.
 */
export async function runGatewayStartupCheck(
  options: GatewayGuardOptions = {},
  log: Pick<Console, 'error' | 'warn' | 'info'> = console,
): Promise<GatewayGuardResult> {
  let result: GatewayGuardResult;
  try {
    result = await checkGatewayProtection(options);
  } catch (cause) {
    // Der Check selbst darf den Start nicht verhindern.
    result = { state: 'unreachable', reason: errorText(cause) };
  }

  if (result.state === 'alarm') {
    alarm = result.problems;
    log.error(
      `ALARM Gateway-Schutz: ${result.problems.join(' | ')} — ` +
        'Apps sind moeglicherweise ohne Forward-Auth erreichbar. ' +
        'infra/traefik/ neu ausrollen und infra/scripts/check-auth.sh laufen lassen.',
    );
    return result;
  }

  alarm = undefined;
  if (result.state === 'unreachable') {
    log.warn(
      `WARN Gateway-Schutz nicht pruefbar: ${result.reason} — ` +
        'kein Befund ueber die Middleware. Nachweis per infra/scripts/check-auth.sh.',
    );
    return result;
  }

  log.info('Gateway-Schutz geprueft: Middleware-Kette, forwardedHeaders und Catch-all stehen.');
  return result;
}
