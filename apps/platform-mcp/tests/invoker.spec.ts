/**
 * Wohin der MCP ein App-Tool weiterleitet (ADR 0011): direkt an den Container,
 * nicht durch Traefik — dort wuerde die Forward-Auth eine Browser-Session
 * verlangen, die ein Agent nicht hat. Und mit einer Signatur, die die App mit
 * **ihrem** Secret pruefen kann.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { identityHeadersForApp } from '@openapps/control-plane/domain';
import type { App, AppManifest } from '@openapps/control-plane/domain';
import { appToolUrl, createHttpInvoker } from '../src/invoker';

const MASTER = 'm'.repeat(48);

const manifest = (env: AppManifest['env'] = []): AppManifest => ({
  manifestVersion: 1,
  name: 'crm',
  displayName: 'CRM',
  description: 'Test',
  category: 'test',
  version: '1.0.0',
  requiredTables: [],
  offeredTools: [{ name: 'contacts.list', description: 'x', verb: 'read', operationId: 'x' }],
  requestedGrants: [],
  env,
  egress: [],
  source: { git: 'https://git.test/crm', tag: 'v1' },
});

const app = (overrides: Partial<App> = {}): App =>
  ({
    id: 'app-1',
    name: 'crm',
    displayName: 'CRM',
    category: 'test',
    manifest: manifest(),
    source: { git: 'https://git.test/crm', tag: 'v1' },
    schemaName: 'app_crm',
    dbRole: 'app_crm',
    primaryDomain: 'apps.example.test',
    currentDeploymentId: null,
    previousDeploymentId: null,
    createdBy: 'user:x',
    createdAt: new Date(0),
    authSecretGeneration: 1,
    ...overrides,
  }) as App;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('appToolUrl', () => {
  it('zeigt auf Netz-Alias, Port und Pfad der App, nicht auf die gemeinsame Domain', () => {
    const url = appToolUrl(app(), 'contacts.list');
    expect(url).toBe('http://openapps-crm:3000/crm/api/tools/contacts.list');
    expect(url).not.toContain('apps.example.test');
  });

  it('nimmt den Port aus dem Manifest', () => {
    const url = appToolUrl(
      app({
        manifest: manifest([
          { name: 'PORT', description: 'Port', secret: false, required: false, default: '8080' },
        ]),
      }),
      'x',
    );
    expect(url).toBe('http://openapps-crm:8080/crm/api/tools/x');
  });

  it('kodiert den Tool-Namen, damit er den Pfad nicht verlassen kann', () => {
    expect(appToolUrl(app(), '../../admin')).toBe(
      'http://openapps-crm:3000/crm/api/tools/..%2F..%2Fadmin',
    );
  });
});

describe('createHttpInvoker', () => {
  it('signiert mit dem Secret dieser App und dem Agenten als Nutzer', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json({ ok: true }),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_794_387_600_000);

    const invoker = createHttpInvoker({ authMasterSecret: MASTER });
    await invoker.invoke({
      app: app(),
      toolName: 'contacts.list',
      actor: { kind: 'agent', id: 'vertrieb' },
      args: { q: 'Ada' },
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('http://openapps-crm:3000/crm/api/tools/contacts.list');
    const headers = init?.headers as Record<string, string>;
    expect(headers['x-auth-user-id']).toBe('agent:vertrieb');
    // Dieselbe Signatur, die die Forward-Auth fuer diese App bilden wuerde —
    // also die, die das SDK in der App mit ihrem Secret prueft.
    const expected = identityHeadersForApp({
      app: app(),
      identity: {
        userId: 'agent:vertrieb',
        email: 'vertrieb@agents.invalid',
        groups: [],
        issuedAt: 1_794_387_600,
      },
      masterSecret: MASTER,
    });
    expect(headers).toMatchObject(expected);
    // Sonst weist das SDK ab: Der Host des direkten Aufrufs ist der Netz-Alias.
    expect(headers['x-forwarded-host']).toBe('apps.example.test');
    expect(JSON.parse(String(init?.body))).toEqual({ q: 'Ada' });
  });

  it('ruft eine nie deployte App nicht auf', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const invoker = createHttpInvoker({ authMasterSecret: MASTER });
    await expect(
      invoker.invoke({
        app: app({ primaryDomain: null }),
        toolName: 'contacts.list',
        actor: { kind: 'agent', id: 'vertrieb' },
        args: {},
      }),
    ).rejects.toThrow(/not deployed/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('mcpToolName', () => {
  it('macht aus der Ressourcen-Id einen Namen, den Claude annimmt', async () => {
    const { mcpToolName } = await import('../src/server');
    const name = mcpToolName('crm.deals.update_stage');
    expect(name).toBe('crm__deals__update_stage');
    expect(name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
  });

  it('vergibt keinen Namen doppelt', async () => {
    const { mcpToolName } = await import('../src/server');
    expect(mcpToolName('a.b', new Set(['a__b']))).toBe('a__b_2');
  });
});
