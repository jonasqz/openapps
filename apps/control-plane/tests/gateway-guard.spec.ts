/**
 * Der Startup-Check gegen die Traefik-API.
 *
 * Das ist der riskante Pfad aus Spec Abschnitt 2, Zeile „Coolify-Update
 * ueberschreibt die statische Traefik-Konfiguration": Faellt die Forward-Auth
 * vom Entrypoint, entsteht kein Fehler — die Apps sind einfach offen. Also
 * wird hier geprueft, dass jeder einzelne Verlust als Alarm ankommt und dass
 * eine nicht erreichbare API **kein** Alarm ist.
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
  type GatewayGuardResult,
} from '../src/infra/gateway-guard';

const API = 'http://traefik:8080';

const HEALTHY_CHAIN = ['openapps-strip-auth-headers@file', 'openapps-forward-auth@file'];

/**
 * Die Antwort von `/api/entrypoints`, gekuerzt auf das, was der Check liest —
 * die Form ist dem echten Lauf entnommen
 * (docs/nachweise/dod-02-laeufe/2026-11-09-lokal-gateway.txt).
 */
function entrypoints(
  options: {
    middlewares?: readonly string[];
    forwardedHeaders?: Readonly<Record<string, unknown>>;
    withoutWebsecure?: boolean;
  } = {},
): unknown {
  const web = { name: 'web', address: ':80' };
  const authz = {
    name: 'authz',
    address: '127.0.0.1:8090',
    forwardedHeaders: { trustedIPs: ['127.0.0.1/32'] },
  };
  if (options.withoutWebsecure === true) return [web, authz];

  return [
    web,
    {
      name: 'websecure',
      address: ':443',
      http: { middlewares: options.middlewares ?? HEALTHY_CHAIN, tls: {} },
      forwardedHeaders: options.forwardedHeaders ?? {},
    },
    authz,
  ];
}

function routers(options: { catchAll?: 'enabled' | 'disabled' | 'missing' } = {}): unknown {
  const app = { name: 'openapps-app1@docker', status: 'enabled', rule: 'Host(`app1.local.test`)' };
  if (options.catchAll === 'missing') return [app];
  return [
    app,
    {
      name: 'openapps-catch-all@file',
      status: options.catchAll ?? 'enabled',
      rule: 'HostRegexp(`^.+$`)',
    },
  ];
}

interface DoubleOptions {
  readonly entrypoints?: unknown;
  readonly routers?: unknown;
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
    const payload = url.includes('/api/entrypoints') ? options.entrypoints : options.routers;
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return double as typeof globalThis.fetch;
}

function check(options: DoubleOptions): Promise<GatewayGuardResult> {
  return checkGatewayProtection({ apiUrl: API, fetch: httpDouble(options), timeoutMs: 50 });
}

function problems(result: GatewayGuardResult): string {
  return result.state === 'alarm' ? result.problems.join(' | ') : `kein Alarm: ${result.state}`;
}

describe('Startup-Check gegen die Traefik-API', () => {
  it('ist zufrieden, wenn Kette, forwardedHeaders und Catch-all stehen', async () => {
    const result = await check({ entrypoints: entrypoints(), routers: routers() });
    expect(result.state).toBe('ok');
  });

  it('schlaegt Alarm, wenn die Forward-Auth fehlt', async () => {
    const result = await check({
      entrypoints: entrypoints({ middlewares: ['openapps-strip-auth-headers@file'] }),
      routers: routers(),
    });

    expect(result.state).toBe('alarm');
    expect(problems(result)).toMatch(/Middleware-Kette/);
  });

  it('schlaegt Alarm, wenn die Strip-Middleware fehlt', async () => {
    const result = await check({
      entrypoints: entrypoints({ middlewares: ['openapps-forward-auth@file'] }),
      routers: routers(),
    });

    expect(result.state).toBe('alarm');
    expect(problems(result)).toMatch(/Middleware-Kette/);
  });

  it('schlaegt Alarm, wenn die Reihenfolge vertauscht ist', async () => {
    // Beide Namen sind da — genau der Fall, der ohne Reihenfolge-Pruefung
    // durchrutscht und Header-Faelschung wieder moeglich macht.
    const result = await check({
      entrypoints: entrypoints({ middlewares: [...HEALTHY_CHAIN].reverse() }),
      routers: routers(),
    });

    expect(result.state).toBe('alarm');
    expect(problems(result)).toMatch(/Reihenfolge/);
  });

  it('schlaegt Alarm, wenn die Kette leer ist oder eine fremde Middleware dazwischensteht', async () => {
    expect(
      problems(await check({ entrypoints: entrypoints({ middlewares: [] }), routers: routers() })),
    ).toMatch(/Middleware-Kette/);
    expect(
      problems(
        await check({
          entrypoints: entrypoints({
            middlewares: [HEALTHY_CHAIN[0] as string, 'fremd@file', HEALTHY_CHAIN[1] as string],
          }),
          routers: routers(),
        }),
      ),
    ).toMatch(/Middleware-Kette/);
  });

  it('schlaegt Alarm, wenn forwardedHeaders nicht leer ist', async () => {
    expect(
      problems(
        await check({
          entrypoints: entrypoints({ forwardedHeaders: { insecure: true } }),
          routers: routers(),
        }),
      ),
    ).toMatch(/forwardedHeaders/);

    expect(
      problems(
        await check({
          entrypoints: entrypoints({ forwardedHeaders: { trustedIPs: ['0.0.0.0/0'] } }),
          routers: routers(),
        }),
      ),
    ).toMatch(/forwardedHeaders/);
  });

  it('schlaegt Alarm, wenn der Entrypoint websecure gar nicht existiert', async () => {
    const result = await check({
      entrypoints: entrypoints({ withoutWebsecure: true }),
      routers: routers(),
    });
    expect(result.state).toBe('alarm');
  });

  it('schlaegt Alarm, wenn der Catch-all fehlt oder abgeschaltet ist', async () => {
    expect(
      problems(
        await check({ entrypoints: entrypoints(), routers: routers({ catchAll: 'missing' }) }),
      ),
    ).toMatch(/Catch-all/);

    expect(
      problems(
        await check({ entrypoints: entrypoints(), routers: routers({ catchAll: 'disabled' }) }),
      ),
    ).toMatch(/Catch-all/);
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

  it('meldet Muell als unreachable — daraus folgt kein Befund ueber die Middleware', async () => {
    const keinJson = await check({ status: 200, body: '<html>nope</html>' });
    expect(keinJson.state).toBe('unreachable');

    const keineListe = await check({ entrypoints: { hallo: 'welt' }, routers: routers() });
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
        fetch: httpDouble({ entrypoints: entrypoints({ middlewares: [] }), routers: routers() }),
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
      { apiUrl: API, fetch: httpDouble({ throws: new Error('kein DNS') }) },
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
});
