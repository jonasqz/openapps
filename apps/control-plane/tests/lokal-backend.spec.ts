/**
 * Der lokale Betrieb (ADR 0011). Riskant ist hier zweierlei: dass die Env der
 * App — DSN mit Passwort, App-Secret — lesbar herumliegt, und dass der
 * Checkout etwas anderes als eine registrierte lokale App holt.
 */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLokalBackend, createLokalRepositoryBackend } from '../src/adapters/lokal';

let root: string;
let config: { runtimeDir: string; sourceDir: string; startTimeoutMs: number };

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lokal-test-'));
  config = {
    runtimeDir: join(root, 'run'),
    sourceDir: join(root, 'quellen'),
    startTimeoutMs: 50,
  };
  mkdirSync(join(config.sourceDir, 'crm', 'src'), { recursive: true });
  mkdirSync(join(config.sourceDir, 'crm', 'node_modules', 'x'), { recursive: true });
  writeFileSync(join(config.sourceDir, 'crm', 'app.json'), '{}');
  writeFileSync(join(config.sourceDir, 'crm', 'src', 'a.ts'), 'export {}');
  writeFileSync(join(config.sourceDir, 'crm', 'node_modules', 'x', 'i.js'), '');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

const spec = { appName: 'crm', gitUrl: 'x', gitRef: 'y', networkAlias: 'openapps-crm', port: 3000 };

describe('lokales Deploy-Backend', () => {
  it('legt die Env nur fuer den Eigentuemer lesbar ab', async () => {
    const backend = createLokalBackend(config);
    const { backendRef } = await backend.createApp(spec);
    await backend.setEnv(backendRef, { DATABASE_URL: 'postgres://app_crm:geheim@db/x' });
    const mode = statSync(join(config.runtimeDir, 'crm', 'env.json')).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('schaltet lokal die Beispieldaten ein, und nur hier', async () => {
    const backend = createLokalBackend(config);
    const { backendRef } = await backend.createApp(spec);
    await backend.setEnv(backendRef, { DATABASE_URL: 'postgres://app_crm:geheim@db/x' });
    const env = JSON.parse(
      readFileSync(join(config.runtimeDir, 'crm', 'env.json'), 'utf8'),
    ) as Record<string, string>;
    expect(env.OPENAPPS_SAMPLE_DATA).toBe('1');
    expect(env.DATABASE_URL).toBe('postgres://app_crm:geheim@db/x');
  });

  it('nimmt keine App ohne lokale Quelle an', async () => {
    const backend = createLokalBackend(config);
    await expect(backend.createApp({ ...spec, appName: 'gibtsnicht' })).rejects.toThrow();
  });

  it('weist fremde Referenzen ab (kein Pfad aus dem Aufrufer)', async () => {
    const backend = createLokalBackend(config);
    await expect(backend.setEnv('lokal:../../etc', {})).rejects.toThrow(/unbekannte/);
    await expect(backend.setEnv('coolify:abc', {})).rejects.toThrow(/unbekannte/);
  });

  it('gilt erst als gestartet, wenn die App Unsigniertes mit 401 ablehnt', async () => {
    const backend = createLokalBackend(config);
    const { backendRef } = await backend.createApp(spec);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 200 })),
    );
    // 200 auf einen unsignierten Aufruf ist keine laufende App, sondern eine offene.
    expect((await backend.deploy({ backendRef, gitSha: 'a' })).ok).toBe(false);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 401 })),
    );
    expect((await backend.deploy({ backendRef, gitSha: 'a' })).ok).toBe(true);
    expect(existsSync(join(config.runtimeDir, 'crm', 'deploy.json'))).toBe(true);
  });

  it('meldet das Inventar als nicht erreichbar statt als sauber', async () => {
    const backend = createLokalBackend(config);
    expect((await backend.readAppGatewayFacts('lokal:crm')).state).toBe('unreachable');
  });
});

describe('lokales Repo-Backend', () => {
  it('holt nur Quellen unter https://lokal.invalid/<app>', async () => {
    const repos = createLokalRepositoryBackend(config);
    await expect(
      repos.checkout({ gitUrl: 'https://github.com/acme/crm', gitSha: 'a' }),
    ).rejects.toThrow();
    await expect(
      repos.checkout({ gitUrl: 'https://lokal.invalid/../quellen', gitSha: 'a' }),
    ).rejects.toThrow();
  });

  it('kopiert den Quelltext ohne node_modules und raeumt wieder auf', async () => {
    const repos = createLokalRepositoryBackend(config);
    const created = await repos.createFromTemplate({
      appName: 'crm',
      description: '',
      requestedBy: 'x',
    });
    expect(created.gitUrl).toBe('https://lokal.invalid/crm');
    const checkout = await repos.checkout({ gitUrl: created.gitUrl, gitSha: 'a' });
    expect(existsSync(join(checkout.dir, 'src', 'a.ts'))).toBe(true);
    expect(existsSync(join(checkout.dir, 'node_modules'))).toBe(false);
    await checkout.dispose();
    expect(existsSync(checkout.dir)).toBe(false);
  });
});
