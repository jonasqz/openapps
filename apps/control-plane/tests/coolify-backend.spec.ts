/**
 * Der Coolify-Adapter an der einen Stelle, an der ADR 0008 ihn aendert: Apps
 * werden **ohne Domain** angelegt, mit einem von uns gewaehlten Netz-Alias und
 * ohne veroeffentlichten Host-Port.
 *
 * Warum jede dieser Zeilen einen eigenen Fall hat: Fehlt eine, erzeugt Coolify
 * der App einen eigenen Traefik-Router — und der traegt unsere Middlewares
 * nicht. Seit der Schutz nicht mehr am Entrypoint haengt, ist das keine
 * Unbequemlichkeit mehr, sondern eine offene App.
 *
 * Kein Netz: `fetch` ist ein Double, das den Rumpf der Anfrage mitschreibt.
 */

import { describe, expect, it } from 'vitest';
import { createCoolifyBackend, type CoolifyConfig } from '../src/adapters/coolify';
import { gatewayAliasFor } from '../src/domain';

const config: CoolifyConfig = {
  baseUrl: 'https://coolify.test',
  apiToken: 'test-token-kein-echtes',
  projectUuid: 'prj-1',
  serverUuid: 'srv-1',
  environmentName: 'production',
  gitBranch: 'main',
  requestTimeoutMs: 1000,
};

interface Call {
  readonly url: string;
  readonly method: string;
  readonly body: Record<string, unknown>;
}

function backendWithRecorder(
  response: unknown = { uuid: 'app-uuid-1' },
  overrides: Partial<CoolifyConfig> = {},
) {
  const calls: Call[] = [];
  const fetchDouble = async (input: unknown, init?: RequestInit): Promise<Response> => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      body:
        init?.body === undefined ? {} : (JSON.parse(String(init.body)) as Record<string, unknown>),
    });
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const original = globalThis.fetch;
  globalThis.fetch = fetchDouble as typeof globalThis.fetch;
  return {
    backend: createCoolifyBackend({ ...config, ...overrides }),
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

async function createApp() {
  const { backend, calls, restore } = backendWithRecorder();
  try {
    await backend.createApp({
      appName: 'projektliste',
      gitUrl: 'https://example.invalid/projektliste.git',
      gitRef: 'v1.0.0',
      networkAlias: gatewayAliasFor('projektliste'),
      port: 3000,
    });
  } finally {
    restore();
  }
  return calls[0]?.body ?? {};
}

describe('App im Deploy-Backend anlegen (ADR 0008)', () => {
  it('sendet autogenerate_domain: false — sonst gibt es eine sslip.io-Domain samt Router', async () => {
    const body = await createApp();

    // `ApplicationsController.php:1690`: Der Default ist `true`. Wer nur
    // `domains` weglaesst, bekommt trotzdem eine Domain.
    expect(body.autogenerate_domain).toBe(false);
  });

  it('sendet keine Domain', async () => {
    const body = await createApp();

    expect(body.domains).toBeUndefined();
    expect(body.fqdn).toBeUndefined();
  });

  it('setzt den stabilen Netz-Alias, nicht den Containernamen', async () => {
    const body = await createApp();

    // Der Containername traegt ein Zeitstempel-Suffix und aendert sich bei
    // jedem Deploy (`docker.php:670-686`). Der Alias ist von uns abgeleitet.
    expect(body.custom_network_aliases).toBe('openapps-projektliste');
    expect(body.custom_network_aliases).toBe(gatewayAliasFor('projektliste'));
  });

  it('setzt zusaetzlich den stabilen Containernamen als zweiten Halt', async () => {
    const body = await createApp();

    expect(body.is_consistent_container_name_enabled).toBe(true);
    expect(body.custom_internal_name).toBe(gatewayAliasFor('projektliste'));
  });

  it('laesst ports_mappings leer — sonst ist die App am Gateway vorbei erreichbar', async () => {
    const body = await createApp();

    expect(body.ports_mappings).toBe('');
  });

  it('gibt den Port der App weiter, damit Coolify ihn nicht raet', async () => {
    const body = await createApp();

    expect(body.ports_exposes).toBe('3000');
  });

  it('bricht ab, wenn das Backend keine Referenz liefert', async () => {
    const { backend, restore } = backendWithRecorder({ message: 'kaputt' });
    try {
      await expect(
        backend.createApp({
          appName: 'crm',
          gitUrl: 'https://example.invalid/crm.git',
          gitRef: 'v1',
          networkAlias: gatewayAliasFor('crm'),
          port: 3000,
        }),
      ).rejects.toThrow(/keine Referenz/);
    } finally {
      restore();
    }
  });
});

describe('was die Coolify-API wirklich annimmt', () => {
  it('klont einen Zweig, nicht den Tag aus dem Register', async () => {
    const body = await createApp();

    // `v1.0.0` existiert in einem frischen Repo nicht. Gebaut wird ohnehin der
    // Commit, den `deploy` festnagelt.
    expect(body.git_branch).toBe('main');
  });

  it('nimmt ohne GitHub-App den oeffentlichen Endpunkt', async () => {
    const { backend, calls, restore } = backendWithRecorder();
    try {
      await backend.createApp({
        appName: 'crm',
        gitUrl: 'https://example.invalid/acme/crm.git',
        gitRef: 'v1',
        networkAlias: gatewayAliasFor('crm'),
        port: 3000,
      });
    } finally {
      restore();
    }
    expect(calls[0]?.url).toBe('https://coolify.test/api/v1/applications/public');
    expect(calls[0]?.body.github_app_uuid).toBeUndefined();
  });

  it('nimmt mit GitHub-App den Endpunkt fuer private Repos und nennt die App', async () => {
    const { backend, calls, restore } = backendWithRecorder(
      { uuid: 'app-uuid-1' },
      { githubAppUuid: 'gh-app-1' },
    );
    try {
      await backend.createApp({
        appName: 'crm',
        gitUrl: 'https://example.invalid/acme/crm.git',
        gitRef: 'v1',
        networkAlias: gatewayAliasFor('crm'),
        port: 3000,
      });
    } finally {
      restore();
    }
    expect(calls[0]?.url).toBe('https://coolify.test/api/v1/applications/private-github-app');
    expect(calls[0]?.body.github_app_uuid).toBe('gh-app-1');
    // Die vier Zeilen aus ADR 0008 gelten auf diesem Weg genauso.
    expect(calls[0]?.body.autogenerate_domain).toBe(false);
    expect(calls[0]?.body.ports_mappings).toBe('');
  });

  it('sendet beim Env-Setzen nur Felder, die die API kennt', async () => {
    const { backend, calls, restore } = backendWithRecorder({ uuid: 'env-1' });
    try {
      await backend.setEnv('app-uuid-1', { DATABASE_SCHEMA: 'app_crm' });
    } finally {
      restore();
    }
    // Die API weist jedes unbekannte Feld mit 422 ab
    // (`ApplicationsController`, `create_env`, `$allowedFields`).
    const allowed = new Set([
      'key',
      'value',
      'is_preview',
      'is_literal',
      'is_multiline',
      'is_shown_once',
      'is_runtime',
      'is_buildtime',
      'comment',
    ]);
    expect(Object.keys(calls[0]?.body ?? {}).filter((key) => !allowed.has(key))).toEqual([]);
    expect(calls[0]?.body).toMatchObject({ key: 'DATABASE_SCHEMA', value: 'app_crm' });
  });

  it('nagelt vor dem Deploy genau den geprueften Commit fest', async () => {
    const { backend, calls, restore } = backendWithRecorder({ deployment_uuid: 'dep-1' });
    try {
      const result = await backend.deploy({ backendRef: 'app-uuid-1', gitSha: 'abc1234' });
      expect(result.ok).toBe(true);
    } finally {
      restore();
    }
    expect(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      'PATCH /api/v1/applications/app-uuid-1',
      'GET /api/v1/deploy',
    ]);
    expect(calls[0]?.body).toEqual({ git_commit_sha: 'abc1234' });
  });
});

describe('was Coolify der App selbst gegeben hat, zurueckgelesen', () => {
  it('liest Labels, Host-Ports und Domain — der gute Fall ist dreimal leer', async () => {
    const { backend, restore } = backendWithRecorder({
      uuid: 'app-uuid-1',
      custom_labels: '',
      ports_mappings: null,
      fqdn: null,
    });
    try {
      const reading = await backend.readAppGatewayFacts('app-uuid-1');
      expect(reading).toEqual({
        state: 'read',
        facts: { labels: {}, portsMappings: '', domains: '' },
      });
    } finally {
      restore();
    }
  });

  it('liest eine von Coolify vergebene Domain aus fqdn **und** domains', async () => {
    const { backend, restore } = backendWithRecorder({
      uuid: 'app-uuid-1',
      fqdn: 'http://1.2.3.4.sslip.io',
      domains: '',
    });
    try {
      const reading = await backend.readAppGatewayFacts('app-uuid-1');
      expect(reading.state === 'read' ? reading.facts.domains : '').toBe('http://1.2.3.4.sslip.io');
    } finally {
      restore();
    }
  });

  it('eine Antwort ohne App ist unreachable und kein Befund', async () => {
    const { backend, restore } = backendWithRecorder({ hallo: 'welt' });
    try {
      const reading = await backend.readAppGatewayFacts('app-uuid-1');
      expect(reading.state).toBe('unreachable');
    } finally {
      restore();
    }
  });
});
