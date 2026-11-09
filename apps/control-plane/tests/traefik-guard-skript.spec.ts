/**
 * Haelt die zwei Fassungen derselben Pruefung zusammen.
 *
 * Es gibt den Gateway-Check zweimal, weil er zu zwei Zeitpunkten gebraucht
 * wird: beim Start der Control Plane (`src/infra/gateway-guard.ts`) und beim
 * Nachweis fuer DoD 2 nach einem Coolify-Update, dann ohne laufende Control
 * Plane (`infra/scripts/traefik-guard.py`, aufgerufen von
 * `infra/scripts/check-auth.sh`).
 *
 * Zwei Fassungen einer Sicherheitspruefung koennen auseinanderlaufen, und dann
 * sagt ein gruener Lauf nichts mehr. Dieser Test gibt beiden **dieselbe**
 * Antwort der Traefik-API und vergleicht nur das Urteil: Alarm oder nicht.
 * Die Texte duerfen sich unterscheiden, das Urteil nicht.
 *
 * Fehlt python3 auf dem Rechner, wird uebersprungen — das Skript ueberspringt
 * sich dann im Betrieb ebenfalls sichtbar.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkGatewayProtection } from '../src/infra/gateway-guard';
import {
  CATCH_ALL_ROUTER,
  FORWARD_AUTH_MIDDLEWARE,
  STRIP_IDENTITY_MIDDLEWARE,
} from '../src/domain';

const CHAIN = [`${STRIP_IDENTITY_MIDDLEWARE}@file`, `${FORWARD_AUTH_MIDDLEWARE}@file`];

const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../infra/scripts/traefik-guard.py',
);

function hasPython(): boolean {
  return spawnSync('python3', ['--version'], { stdio: 'ignore' }).status === 0;
}

interface Snapshot {
  readonly routers: readonly unknown[];
  readonly middlewares: readonly unknown[];
  readonly entrypoints: readonly unknown[];
}

function healthy(): Snapshot {
  return {
    routers: [
      {
        name: 'openapps-app-projektliste@file',
        status: 'enabled',
        rule: 'Host(`intern.apps.test`) && PathPrefix(`/projektliste`)',
        middlewares: CHAIN,
        service: 'openapps-app-projektliste@file',
      },
      {
        name: `${CATCH_ALL_ROUTER}@file`,
        status: 'enabled',
        rule: 'Host(`intern.apps.test`)',
        middlewares: CHAIN,
        service: 'openapps-deny@file',
      },
      // Coolifys eigener Router. Er traegt unsere Kette nicht und darf das
      // auch nicht — beide Fassungen muessen ihn ignorieren.
      { name: 'catchall-http@docker', status: 'enabled', rule: 'PathPrefix(`/`)' },
    ],
    middlewares: [
      { name: `${STRIP_IDENTITY_MIDDLEWARE}@file`, status: 'enabled', type: 'headers' },
      { name: `${FORWARD_AUTH_MIDDLEWARE}@file`, status: 'enabled', type: 'forwardauth' },
    ],
    entrypoints: [
      { name: 'http', address: ':80' },
      { name: 'https', address: ':443', forwardedHeaders: {} },
    ],
  };
}

/** Dieselben Faelle, die im Startup-Check einzeln stehen. */
const FAELLE: readonly { readonly name: string; readonly snapshot: Snapshot }[] = [
  { name: 'alles steht', snapshot: healthy() },
  {
    name: 'ein Router ohne Kette',
    snapshot: {
      ...healthy(),
      routers: healthy().routers.map((router) =>
        (router as { name: string }).name.startsWith('openapps-app-')
          ? { ...(router as object), middlewares: [] }
          : router,
      ),
    },
  },
  {
    name: 'Kette vertauscht',
    snapshot: {
      ...healthy(),
      routers: healthy().routers.map((router) =>
        (router as { name: string }).name.startsWith('openapps-app-')
          ? { ...(router as object), middlewares: [...CHAIN].reverse() }
          : router,
      ),
    },
  },
  {
    name: 'Forward-Auth-Middleware fehlt',
    snapshot: {
      ...healthy(),
      middlewares: healthy().middlewares.filter(
        (middleware) => !(middleware as { name: string }).name.startsWith(FORWARD_AUTH_MIDDLEWARE),
      ),
    },
  },
  {
    name: 'Middleware disabled',
    snapshot: {
      ...healthy(),
      middlewares: healthy().middlewares.map((middleware) => ({
        ...(middleware as object),
        status: 'disabled',
      })),
    },
  },
  {
    name: 'Router disabled',
    snapshot: {
      ...healthy(),
      routers: healthy().routers.map((router) =>
        (router as { name: string }).name.startsWith('openapps-app-')
          ? { ...(router as object), status: 'disabled' }
          : router,
      ),
    },
  },
  {
    name: 'Catch-all fehlt',
    snapshot: {
      ...healthy(),
      routers: healthy().routers.filter(
        (router) => !(router as { name: string }).name.startsWith(CATCH_ALL_ROUTER),
      ),
    },
  },
  {
    name: 'unsere Konfiguration ist nicht geladen',
    snapshot: {
      ...healthy(),
      routers: healthy().routers.filter(
        (router) => !(router as { name: string }).name.startsWith('openapps-'),
      ),
    },
  },
  {
    name: 'forwardedHeaders am Entrypoint gesetzt',
    snapshot: {
      ...healthy(),
      entrypoints: healthy().entrypoints.map((entry) =>
        (entry as { name: string }).name === 'https'
          ? { ...(entry as object), forwardedHeaders: { insecure: true } }
          : entry,
      ),
    },
  },
  {
    name: 'der Entrypoint, an dem wir haengen, fehlt',
    snapshot: {
      ...healthy(),
      entrypoints: healthy().entrypoints.filter(
        (entry) => (entry as { name: string }).name !== 'https',
      ),
    },
  },
];

async function urteilTypeScript(snapshot: Snapshot): Promise<'alarm' | 'ok'> {
  const double = async (input: unknown): Promise<Response> => {
    const url = String(input);
    const payload = url.includes('/api/entrypoints')
      ? snapshot.entrypoints
      : url.includes('/api/http/middlewares')
        ? snapshot.middlewares
        : snapshot.routers;
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const result = await checkGatewayProtection({
    apiUrl: 'http://traefik:8080',
    fetch: double as typeof globalThis.fetch,
    timeoutMs: 50,
    entryPoint: 'https',
  });
  return result.state === 'alarm' ? 'alarm' : 'ok';
}

function urteilSkript(snapshot: Snapshot): { urteil: 'alarm' | 'ok'; ausgabe: string } {
  const run = spawnSync('python3', ['-I', SCRIPT], {
    input: JSON.stringify({ ...snapshot, entrypoint: 'https' }),
    encoding: 'utf8',
  });
  const ausgabe = `${run.stdout}${run.stderr}`;
  // Exit 2 heisst „nicht auswertbar" — in diesem Test kommt immer eine
  // auswertbare Antwort, also waere das ein Fehler im Skript.
  expect(run.status, `unerwarteter Exit-Code ${String(run.status)}: ${ausgabe}`).not.toBe(2);
  return { urteil: run.status === 1 ? 'alarm' : 'ok', ausgabe };
}

describe('Skript und Startup-Check urteilen gleich', () => {
  if (!hasPython()) {
    it.skip('python3 fehlt — der Vergleich kann nicht gefuehrt werden', () => undefined);
    return;
  }

  for (const fall of FAELLE) {
    it(`${fall.name}`, async () => {
      const erwartet = await urteilTypeScript(fall.snapshot);
      const { urteil, ausgabe } = urteilSkript(fall.snapshot);
      expect(urteil, `Skript sagt "${urteil}", Startup-Check "${erwartet}":\n${ausgabe}`).toBe(
        erwartet,
      );
    });
  }

  it('der gesunde Fall ist wirklich gruen — sonst vergleicht der Test zwei Alarme', async () => {
    expect(await urteilTypeScript(healthy())).toBe('ok');
    expect(urteilSkript(healthy()).urteil).toBe('ok');
  });

  it('Muell auf stdin ist kein Befund, sondern Exit 2', () => {
    const run = spawnSync('python3', ['-I', SCRIPT], { input: 'kein json', encoding: 'utf8' });
    expect(run.status).toBe(2);
    expect(run.stdout).toBe('');
  });
});
