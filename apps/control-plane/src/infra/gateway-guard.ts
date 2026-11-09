/**
 * Startup-Check gegen die Traefik-API: Laeuft wirklich das, was wir
 * geschrieben haben?
 *
 * ## Was sich mit ADR 0008 geaendert hat
 *
 * Die alte Fassung pruefte die Middleware-Kette am Entrypoint `websecure`.
 * Diese Kette gibt es nicht mehr: Entrypoints stehen in Traefiks **statischer**
 * Konfiguration, die gehoert Coolify, und wir fassen sie nicht an (ADR 0008).
 * Die Forward-Auth haengt jetzt an **jedem einzelnen Router**, den unser
 * Generator ausgibt.
 *
 * Damit prueft dieser Check vier Dinge, und alle vier sind Alarm, kein
 * Hinweis:
 *
 *  1. Unsere zwei Middlewares gibt es in der laufenden Konfiguration und sie
 *     sind `enabled`. Fehlt eine, zeigt jeder Router auf etwas, das es nicht
 *     gibt — Traefik schaltet solche Router ab, aber darauf wollen wir uns
 *     nicht verlassen.
 *  2. **Jeder** unserer Router traegt genau `[strip, forward-auth]`, in dieser
 *     Reihenfolge. Nicht eine Liste erwarteter Namen: geprueft wird jeder
 *     Router, dessen Name mit `openapps-` beginnt — auch einer, den es heute
 *     noch nicht gibt.
 *  3. Jeder unserer Router ist `enabled`. Ein Router mit einem Fehler in der
 *     Regel ist in der API `disabled` und schweigt sonst.
 *  4. Der Catch-all ist da und `enabled`. Ohne ihn landet ein unbekannter Pfad
 *     in Traefiks 404 statt im Deny-Backend.
 *
 * Dazu, unveraendert aus der alten Fassung und weiter noetig:
 * `forwardedHeaders` am Entrypoint, an dem unsere Router haengen, ist leer.
 * Steht dort `insecure: true` oder eine weite `trustedIPs`-Liste, bestimmt der
 * Aufrufer `X-Forwarded-Host` — und damit die Pfad-Allowlist aus Spec 1.3, die
 * genau diesem Header vertraut. Dieser Entrypoint gehoert jetzt Coolify; genau
 * deshalb ist es wichtig, ihn zu messen statt ihn zu setzen.
 *
 * Die Unterscheidung bleibt, und sie ist der ganze Zweck: „Ich habe nichts
 * erfahren" (`unreachable`) ist kein Befund, „die Antwort ist da und falsch"
 * (`alarm`) ist einer.
 */

import {
  CATCH_ALL_ROUTER,
  FORWARD_AUTH_MIDDLEWARE,
  ROUTER_MIDDLEWARES,
  STRIP_IDENTITY_MIDDLEWARE,
} from '../domain/gateway-config';

/** Praefix, an dem unsere Router und Middlewares erkennbar sind. */
export const OWN_PREFIX = 'openapps-';

/** Die zwei Middlewares, die es in der laufenden Konfiguration geben muss. */
export const REQUIRED_MIDDLEWARES: readonly string[] = [
  STRIP_IDENTITY_MIDDLEWARE,
  FORWARD_AUTH_MIDDLEWARE,
];

/** Der Catch-all, wie er in unserer Konfiguration heisst. */
export const REQUIRED_CATCH_ALL_ROUTER = CATCH_ALL_ROUTER;

/**
 * Drei Zustaende, nicht zwei. Siehe Dateikopf, letzter Absatz.
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
  /**
   * Der Entrypoint, an dem unsere Router haengen — in Coolifys statischer
   * Konfiguration `https`. Default `GATEWAY_ENTRYPOINT` bzw. `https`.
   */
  readonly entryPoint?: string;
}

const DEFAULT_API_URL = 'http://traefik:8080';
const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_ENTRYPOINT = 'https';

export function traefikApiUrl(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const raw = env.TRAEFIK_API_URL;
  return (raw === undefined || raw.trim() === '' ? DEFAULT_API_URL : raw.trim()).replace(
    /\/+$/,
    '',
  );
}

export function guardedEntryPoint(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const raw = env.GATEWAY_ENTRYPOINT;
  return raw === undefined || raw.trim() === '' ? DEFAULT_ENTRYPOINT : raw.trim();
}

/** Name ohne Provider-Suffix: `openapps-forward-auth@file` → `openapps-forward-auth`. */
function plainName(value: string): string {
  return value.split('@')[0] ?? value;
}

export async function checkGatewayProtection(
  options: GatewayGuardOptions = {},
): Promise<GatewayGuardResult> {
  const base = (options.apiUrl ?? traefikApiUrl()).replace(/\/+$/, '');
  const http = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const entryPoint = options.entryPoint ?? guardedEntryPoint();

  const routers = await getJson(http, `${base}/api/http/routers`, timeoutMs);
  if (!routers.ok) return { state: 'unreachable', reason: routers.reason };

  const middlewares = await getJson(http, `${base}/api/http/middlewares`, timeoutMs);
  if (!middlewares.ok) return { state: 'unreachable', reason: middlewares.reason };

  const entrypoints = await getJson(http, `${base}/api/entrypoints`, timeoutMs);
  if (!entrypoints.ok) return { state: 'unreachable', reason: entrypoints.reason };

  // Keine Liste heisst: Das ist keine Traefik-API. Dann wissen wir nichts
  // ueber die Konfiguration — also `unreachable` und nicht Alarm. Ein Alarm
  // hier wuerde bei einer falsch gesetzten `TRAEFIK_API_URL` losgehen und
  // damit genau das Signal abstumpfen, das bei einem echten Verlust des
  // Schutzes zaehlt.
  if (!Array.isArray(routers.value)) {
    return { state: 'unreachable', reason: '/api/http/routers liefert keine Liste' };
  }
  if (!Array.isArray(middlewares.value)) {
    return { state: 'unreachable', reason: '/api/http/middlewares liefert keine Liste' };
  }
  if (!Array.isArray(entrypoints.value)) {
    return { state: 'unreachable', reason: '/api/entrypoints liefert keine Liste' };
  }

  const problems: string[] = [
    ...middlewareProblems(middlewares.value),
    ...routerProblems(routers.value),
    ...entrypointProblems(entrypoints.value, entryPoint),
  ];

  return problems.length === 0 ? { state: 'ok' } : { state: 'alarm', problems };
}

/** 1. Die zwei Middlewares gibt es, und sie sind `enabled`. */
function middlewareProblems(middlewares: readonly unknown[]): readonly string[] {
  const problems: string[] = [];
  const byName = new Map<string, Record<string, unknown>>();
  for (const entry of middlewares.filter(isRecord)) {
    if (typeof entry.name === 'string') byName.set(plainName(entry.name), entry);
  }

  for (const name of REQUIRED_MIDDLEWARES) {
    const middleware = byName.get(name);
    if (middleware === undefined) {
      problems.push(`Middleware "${name}" fehlt in der laufenden Konfiguration`);
      continue;
    }
    if (middleware.status !== 'enabled') {
      problems.push(
        `Middleware "${name}" hat status "${String(middleware.status)}", erwartet "enabled"`,
      );
    }
  }
  return problems;
}

/**
 * 2., 3. und 4.: jeder unserer Router. Ueber die **Ausgabe** der API
 * iteriert, nicht ueber eine Liste erwarteter Namen — ein neuer Router-Typ
 * wird dadurch von selbst mitgeprueft.
 */
function routerProblems(routers: readonly unknown[]): readonly string[] {
  const problems: string[] = [];
  const own = routers
    .filter(isRecord)
    .filter((entry) => typeof entry.name === 'string' && entry.name.startsWith(OWN_PREFIX));

  if (own.length === 0) {
    problems.push(
      `kein einziger Router mit dem Praefix "${OWN_PREFIX}" in der laufenden Konfiguration — ` +
        'unsere dynamische Datei ist nicht geladen',
    );
  }

  for (const router of own) {
    const name = String(router.name);
    const chain = Array.isArray(router.middlewares)
      ? router.middlewares.map((item) => plainName(String(item)))
      : [];

    if (
      chain.length !== ROUTER_MIDDLEWARES.length ||
      chain.some((middleware, index) => middleware !== ROUTER_MIDDLEWARES[index])
    ) {
      problems.push(
        `Router "${name}" traegt die Kette [${chain.join(', ')}], erwartet ` +
          `[${ROUTER_MIDDLEWARES.join(', ')}] in genau dieser Reihenfolge`,
      );
    }
    if (router.status !== 'enabled') {
      problems.push(`Router "${name}" hat status "${String(router.status)}", erwartet "enabled"`);
    }
  }

  const catchAll = own.find(
    (router) => plainName(String(router.name)) === REQUIRED_CATCH_ALL_ROUTER,
  );
  if (catchAll === undefined) {
    problems.push(`Catch-all-Router "${REQUIRED_CATCH_ALL_ROUTER}" fehlt`);
  }

  return problems;
}

/** `forwardedHeaders` am Entrypoint, an dem unsere Router haengen. */
function entrypointProblems(
  entrypoints: readonly unknown[],
  entryPoint: string,
): readonly string[] {
  const entry = entrypoints.filter(isRecord).find((item) => item.name === entryPoint);
  if (entry === undefined) {
    // Hier wissen wir etwas: Die Antwort ist verwertbar und der Entrypoint,
    // an dem unsere Router haengen, kommt darin nicht vor. Dann laeuft keiner
    // von ihnen.
    return [`Entrypoint "${entryPoint}" gibt es nicht — unsere Router haengen an keinem Eingang`];
  }

  const forwarded = entry.forwardedHeaders;
  if (forwarded === undefined || forwarded === null) return [];
  if (!isRecord(forwarded)) {
    return [`forwardedHeaders am Entrypoint "${entryPoint}" hat eine unbekannte Form`];
  }
  const keys = Object.keys(forwarded).filter((key) => {
    const value = forwarded[key];
    if (value === null || value === undefined || value === false) return false;
    return !(Array.isArray(value) && value.length === 0);
  });
  if (keys.length === 0) return [];
  return [
    `forwardedHeaders am Entrypoint "${entryPoint}" ist nicht leer (${keys.join(', ')}) — ` +
      'ein Client koennte X-Forwarded-Host setzen und damit die Pfad-Allowlist aus Spec 1.3 erschleichen',
  ];
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
 * dann sperrt Traefik **jeden** Pfad, auch den Login, auch die Oberflaeche,
 * ueber die die Konfiguration wieder ausgerollt wird (Nachweis: Control Plane
 * gestoppt → kein Durchlass). Der gefaehrliche Zustand ist aber genau
 * umgekehrt: Der Schutz fehlt, die Apps sind offen, und jemand muss die
 * Konfiguration neu schreiben. Dazu braucht er eine laufende Control Plane.
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
        'openapps.yaml neu schreiben (Deploy einer App genuegt) und ' +
        'infra/scripts/check-auth.sh laufen lassen.',
    );
    return result;
  }

  alarm = undefined;
  if (result.state === 'unreachable') {
    log.warn(
      `WARN Gateway-Schutz nicht pruefbar: ${result.reason} — ` +
        'kein Befund ueber die Router. Nachweis per infra/scripts/check-auth.sh.',
    );
    return result;
  }

  log.info(
    'Gateway-Schutz geprueft: Middlewares, Catch-all und die Kette jedes eigenen Routers stehen.',
  );
  return result;
}
