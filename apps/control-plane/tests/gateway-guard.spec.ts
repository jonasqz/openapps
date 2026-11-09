/**
 * Der Startup-Check gegen die Traefik-API.
 *
 * Das ist der riskante Pfad aus ADR 0008: Die Forward-Auth haengt nicht mehr
 * an einer Stelle, sondern an jedem einzelnen Router unserer dynamischen
 * Konfiguration. Faellt die Datei weg oder laedt Traefik sie nicht, entsteht
 * kein Fehler — die Apps sind dann nicht erreichbar (Coolifys Catch-all bei
 * `priority: -1000`), und ein Router ohne unsere Kette waere offen. Also wird
 * hier geprueft, dass jeder einzelne Verlust als Alarm ankommt und dass eine
 * nicht erreichbare API **kein** Alarm ist.
 *
 * Der wichtigste Fall: Die Pruefung iteriert ueber die Router, die die API
 * nennt, und nicht ueber eine Liste erwarteter Namen. Ein Router, den wir
 * heute nicht kennen, wird mitgeprueft, sobald er in der Antwort steht — der
 * Fall „ein fremder openapps-Router ohne Kette" steht unten.
 *
 * Kein Netz: Der HTTP-Zugang ist ein Double.
 */

import { describe, expect, it } from 'vitest';
import {
  checkGatewayProtection,
  gatewayAlarm,
  resetGatewayAlarm,
  runGatewayStartupCheck,
  traefikApiUrl,
  guardedEntryPoint,
  type GatewayGuardResult,
} from '../src/infra/gateway-guard';
import {
  CATCH_ALL_ROUTER,
  FORWARD_AUTH_MIDDLEWARE,
  STRIP_IDENTITY_MIDDLEWARE,
} from '../src/domain';

const API = 'http://traefik:8080';

/** Die Kette, wie die Traefik-API sie nennt: mit Provider-Suffix. */
const HEALTHY_CHAIN = [`${STRIP_IDENTITY_MIDDLEWARE}@file`, `${FORWARD_AUTH_MIDDLEWARE}@file`];

/**
 * Die Antwort von `/api/http/middlewares`, gekuerzt auf das, was der Check
 * liest.
 */
function middlewares(options: { missing?: string; status?: string } = {}): unknown {
  return [STRIP_IDENTITY_MIDDLEWARE, FORWARD_AUTH_MIDDLEWARE]
    .filter((name) => name !== options.missing)
    .map((name) => ({
      name: `${name}@file`,
      status: options.status ?? 'enabled',
      type: 'headers',
    }));
}

/** Die Antwort von `/api/http/routers`. */
function routers(
  options: {
    catchAll?: 'enabled' | 'disabled' | 'missing';
    appChain?: readonly string[];
    appStatus?: string;
    extra?: readonly Record<string, unknown>[];
    /** Ein Router, den dieser Test noch nicht kennt — wird mitgeprueft. */
    neuerRouterOhneKette?: boolean;
  } = {},
): unknown {
  const app = {
    name: 'openapps-app-projektliste@file',
    status: options.appStatus ?? 'enabled',
    rule: 'Host(`intern.apps.test`) && PathPrefix(`/projektliste`)',
    middlewares: options.appChain ?? HEALTHY_CHAIN,
    service: 'openapps-app-projektliste@file',
  };
  const catchAll = {
    name: `${CATCH_ALL_ROUTER}@file`,
    status: options.catchAll ?? 'enabled',
    rule: 'Host(`intern.apps.test`)',
    middlewares: HEALTHY_CHAIN,
    service: 'openapps-deny@file',
  };
  // Coolifys eigener Catch-all. Er traegt unsere Kette nicht und darf das
  // auch nicht — er faengt die Hosts ohne Router ab und hat `priority: -1000`.
  const coolify = {
    name: 'catchall-http@docker',
    status: 'enabled',
    rule: 'PathPrefix(`/`)',
    service: 'noop@internal',
  };

  return [
    app,
    ...(options.catchAll === 'missing' ? [] : [catchAll]),
    coolify,
    ...(options.neuerRouterOhneKette === true
      ? [
          {
            name: 'openapps-irgendwas-neues@file',
            status: 'enabled',
            rule: 'Host(`intern.apps.test`) && PathPrefix(`/neu`)',
            service: 'openapps-neu@file',
          },
        ]
      : []),
    ...(options.extra ?? []),
  ];
}

function entrypoints(
  options: { forwardedHeaders?: Readonly<Record<string, unknown>>; withoutHttps?: boolean } = {},
): unknown {
  const http = { name: 'http', address: ':80' };
  if (options.withoutHttps === true) return [http];
  return [
    http,
    {
      name: 'https',
      address: ':443',
      http: { tls: {} },
      forwardedHeaders: options.forwardedHeaders ?? {},
    },
  ];
}

interface DoubleOptions {
  readonly entrypoints?: unknown;
  readonly routers?: unknown;
  readonly middlewares?: unknown;
  /** Antwortet auf jeden Aufruf mit diesem Status und Rumpf — fuer Fehlercodes und Muell. */
  readonly status?: number;
  readonly body?: string;
  readonly throws?: Error;
}

/** Erfuellt nur den Teil von `fetch`, den der Check benutzt: URL rein, Response raus. */
function httpDouble(options: DoubleOptions): typeof globalThis.fetch {
  const double = async (input: unknown): Promise<Response> => {
    if (options.throws !== undefined) throw options.throws;
    const url = String(input);
    if (options.body !== undefined || options.status !== undefined) {
      return new Response(options.body ?? '', { status: options.status ?? 200 });
    }
    const payload = url.includes('/api/entrypoints')
      ? (options.entrypoints ?? entrypoints())
      : url.includes('/api/http/middlewares')
        ? (options.middlewares ?? middlewares())
        : (options.routers ?? routers());
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return double as typeof globalThis.fetch;
}

function check(options: DoubleOptions): Promise<GatewayGuardResult> {
  return checkGatewayProtection({
    apiUrl: API,
    fetch: httpDouble(options),
    timeoutMs: 50,
    entryPoint: 'https',
  });
}

function problems(result: GatewayGuardResult): string {
  return result.state === 'alarm' ? result.problems.join(' | ') : `kein Alarm: ${result.state}`;
}

describe('Startup-Check gegen die Traefik-API', () => {
  it('ist zufrieden, wenn Middlewares, Ketten, Catch-all und Entrypoint stehen', async () => {
    const result = await check({});
    expect(problems(result)).toBe('kein Alarm: ok');
  });

  it('stoert sich nicht an Coolifys eigenen Routern — nur an unseren', async () => {
    const result = await check({
      routers: routers({
        extra: [{ name: 'coolify@docker', status: 'enabled', rule: 'Host(`coolify.test`)' }],
      }),
    });
    expect(result.state).toBe('ok');
  });

  it('schlaegt Alarm, wenn die Forward-Auth-Middleware fehlt', async () => {
    const result = await check({ middlewares: middlewares({ missing: FORWARD_AUTH_MIDDLEWARE }) });

    expect(result.state).toBe('alarm');
    expect(problems(result)).toContain(FORWARD_AUTH_MIDDLEWARE);
  });

  it('schlaegt Alarm, wenn die Strip-Middleware fehlt', async () => {
    const result = await check({
      middlewares: middlewares({ missing: STRIP_IDENTITY_MIDDLEWARE }),
    });

    expect(result.state).toBe('alarm');
    expect(problems(result)).toContain(STRIP_IDENTITY_MIDDLEWARE);
  });

  it('schlaegt Alarm, wenn eine Middleware nicht enabled ist', async () => {
    expect(problems(await check({ middlewares: middlewares({ status: 'disabled' }) }))).toMatch(
      /status "disabled"/,
    );
  });

  it('schlaegt Alarm, wenn ein Router die Forward-Auth nicht traegt', async () => {
    const result = await check({
      routers: routers({ appChain: [`${STRIP_IDENTITY_MIDDLEWARE}@file`] }),
    });

    expect(result.state).toBe('alarm');
    expect(problems(result)).toMatch(/openapps-app-projektliste/);
  });

  it('schlaegt Alarm, wenn die Reihenfolge am Router vertauscht ist', async () => {
    // Beide Namen sind da — genau der Fall, der ohne Reihenfolge-Pruefung
    // durchrutscht und Header-Faelschung wieder moeglich macht.
    const result = await check({ routers: routers({ appChain: [...HEALTHY_CHAIN].reverse() }) });

    expect(result.state).toBe('alarm');
    expect(problems(result)).toMatch(/Reihenfolge/);
  });

  it('schlaegt Alarm, wenn eine fremde Middleware in der Kette steht', async () => {
    const result = await check({
      routers: routers({
        appChain: ['fremd@file', HEALTHY_CHAIN[0] as string, HEALTHY_CHAIN[1] as string],
      }),
    });

    expect(problems(result)).toMatch(/Reihenfolge|erwartet/);
  });

  it('prueft auch einen Router, den dieser Test noch nicht kennt', async () => {
    // Der Fall, auf den es ankommt: Ein neuer Router-Typ ohne Kette faellt
    // auf, ohne dass hier ein Name nachgetragen wird.
    const result = await check({ routers: routers({ neuerRouterOhneKette: true }) });

    expect(result.state).toBe('alarm');
    expect(problems(result)).toContain('openapps-irgendwas-neues');
  });

  it('schlaegt Alarm, wenn ein Router nicht enabled ist', async () => {
    expect(problems(await check({ routers: routers({ appStatus: 'disabled' }) }))).toMatch(
      /status "disabled"/,
    );
  });

  it('schlaegt Alarm, wenn gar kein eigener Router laeuft — die Datei ist nicht geladen', async () => {
    const result = await check({
      routers: [{ name: 'coolify@docker', status: 'enabled', rule: 'Host(`coolify.test`)' }],
    });

    expect(result.state).toBe('alarm');
    expect(problems(result)).toMatch(/nicht geladen/);
  });

  it('schlaegt Alarm, wenn der Catch-all fehlt oder abgeschaltet ist', async () => {
    expect(problems(await check({ routers: routers({ catchAll: 'missing' }) }))).toMatch(
      /Catch-all/,
    );
    expect(problems(await check({ routers: routers({ catchAll: 'disabled' }) }))).toMatch(
      /status "disabled"/,
    );
  });

  it('schlaegt Alarm, wenn forwardedHeaders am Entrypoint nicht leer ist', async () => {
    expect(
      problems(await check({ entrypoints: entrypoints({ forwardedHeaders: { insecure: true } }) })),
    ).toMatch(/forwardedHeaders/);

    expect(
      problems(
        await check({
          entrypoints: entrypoints({ forwardedHeaders: { trustedIPs: ['0.0.0.0/0'] } }),
        }),
      ),
    ).toMatch(/forwardedHeaders/);
  });

  it('schlaegt Alarm, wenn den Entrypoint unserer Router gar nicht gibt', async () => {
    const result = await check({ entrypoints: entrypoints({ withoutHttps: true }) });
    expect(result.state).toBe('alarm');
    expect(problems(result)).toMatch(/Entrypoint "https"/);
  });

  it('meldet eine nicht erreichbare API als unreachable, nicht als Alarm', async () => {
    const result = await check({ throws: new Error('ECONNREFUSED') });

    expect(result.state).toBe('unreachable');
    expect(result.state === 'unreachable' ? result.reason : '').toMatch(/ECONNREFUSED/);
  });

  it('meldet einen Fehlercode der API als unreachable', async () => {
    const result = await check({ status: 503, body: 'Service Unavailable' });
    expect(result.state).toBe('unreachable');
  });

  it('meldet Muell als unreachable — daraus folgt kein Befund ueber den Schutz', async () => {
    const keinJson = await check({ status: 200, body: '<html>nope</html>' });
    expect(keinJson.state).toBe('unreachable');

    const keineListe = await check({ routers: { hallo: 'welt' } });
    expect(keineListe.state).toBe('unreachable');
  });
});

describe('Was bei Alarm passiert', () => {
  const silent = { error: () => {}, warn: () => {}, info: () => {} };

  it('merkt den Alarm im Prozess und protokolliert ihn laut', async () => {
    resetGatewayAlarm();
    const lines: string[] = [];

    const result = await runGatewayStartupCheck(
      {
        apiUrl: API,
        entryPoint: 'https',
        fetch: httpDouble({ routers: routers({ appChain: [] }) }),
      },
      { ...silent, error: (line: string) => lines.push(line) },
    );

    expect(result.state).toBe('alarm');
    expect(lines.join('\n')).toMatch(/^ALARM/);
    expect(gatewayAlarm()).toBeDefined();
    resetGatewayAlarm();
  });

  it('setzt keinen Alarm, wenn nur die API nicht erreichbar ist', async () => {
    resetGatewayAlarm();
    const warnings: string[] = [];

    const result = await runGatewayStartupCheck(
      { apiUrl: API, entryPoint: 'https', fetch: httpDouble({ throws: new Error('kein DNS') }) },
      { ...silent, warn: (line: string) => warnings.push(line) },
    );

    expect(result.state).toBe('unreachable');
    expect(warnings.join('\n')).toMatch(/^WARN/);
    // Der Unterschied, auf den es ankommt: kein Alarmzustand und kein ALARM im
    // Protokoll — eine stumme API ist kein Befund ueber den Schutz.
    expect(gatewayAlarm()).toBeUndefined();
  });

  it('nimmt die Adresse der Traefik-API aus der Env, mit dem Dienstnamen als Default', () => {
    expect(traefikApiUrl({})).toBe('http://traefik:8080');
    expect(traefikApiUrl({ TRAEFIK_API_URL: 'http://127.0.0.1:8081/' })).toBe(
      'http://127.0.0.1:8081',
    );
  });

  it('nimmt den Entrypoint aus der Env, mit Coolifys Namen als Default', () => {
    // `https`, nicht `websecure`: Der Name kommt aus Coolifys statischer
    // Konfiguration, die wir nicht anfassen (ADR 0008).
    expect(guardedEntryPoint({})).toBe('https');
    expect(guardedEntryPoint({ GATEWAY_ENTRYPOINT: 'websecure' })).toBe('websecure');
  });
});
