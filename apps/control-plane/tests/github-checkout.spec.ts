/**
 * Der Checkout fuer das Review-Gate: ein Commit als Tarball, entpackt auf der
 * Platte der Control Plane.
 *
 * Riskant ist hier nicht das Entpacken, sondern **was** geholt wird: Die URL
 * kommt aus dem Register, der Hash vom Aufrufer. Beide gehen in einen
 * API-Pfad — also wird beides geprueft, bevor etwas das Netz sieht.
 *
 * Kein Netz: `fetch` ist ein Double, das ein hier gebautes Archiv liefert.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createGitHubRepositoryBackend, repositorySlug } from '../src/adapters/github';
import type { GitHubConfig } from '../src/adapters/github';

const config: GitHubConfig = {
  apiBaseUrl: 'https://git.test',
  token: 'test-token-kein-echtes',
  owner: 'acme',
  templateRepo: 'acme/starter',
  private: true,
  initialTag: 'v0.0.0',
  requestTimeoutMs: 1000,
  checkoutTimeoutMs: 1000,
  checkoutMaxBytes: 1024 * 1024,
};

/** Ein Archiv, wie die Tarball-API es liefert: alles unter einem Ordner. */
function archive(): Buffer {
  const root = mkdtempSync(join(tmpdir(), 'openapps-test-archive-'));
  try {
    mkdirSync(join(root, 'acme-crm-abc1234', 'src'), { recursive: true });
    writeFileSync(join(root, 'acme-crm-abc1234', 'app.json'), '{"name":"crm"}');
    writeFileSync(join(root, 'acme-crm-abc1234', 'src', 'index.ts'), 'export {};\n');
    execFileSync('tar', ['-czf', join(root, 'a.tar.gz'), '-C', root, 'acme-crm-abc1234']);
    return readFileSync(join(root, 'a.tar.gz'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function fetchReturning(response: () => Response): { urls: string[] } {
  const urls: string[] = [];
  globalThis.fetch = (async (input: unknown) => {
    urls.push(String(input));
    return response();
  }) as typeof globalThis.fetch;
  return { urls };
}

describe('Checkout eines Commits', () => {
  it('holt genau den Commit des Repos aus dem Register und legt app.json oben ab', async () => {
    const bytes = archive();
    const { urls } = fetchReturning(() => new Response(bytes, { status: 200 }));

    const checkout = await createGitHubRepositoryBackend(config).checkout({
      gitUrl: 'https://github.com/acme/crm.git',
      gitSha: 'abc1234',
    });
    try {
      expect(urls).toEqual(['https://git.test/repos/acme/crm/tarball/abc1234']);
      expect(readFileSync(join(checkout.dir, 'app.json'), 'utf8')).toBe('{"name":"crm"}');
      expect(existsSync(join(checkout.dir, 'src', 'index.ts'))).toBe(true);
    } finally {
      await checkout.dispose();
    }
    // Der Quelltext bleibt nicht liegen — und zweimal aufraeumen ist erlaubt.
    expect(existsSync(checkout.dir)).toBe(false);
    await expect(checkout.dispose()).resolves.toBeUndefined();
  });

  it('weist alles ab, was kein Commit-Hash ist, bevor es das Netz sieht', async () => {
    const { urls } = fetchReturning(() => new Response('', { status: 200 }));
    const backend = createGitHubRepositoryBackend(config);

    for (const gitSha of ['main', '../../orgs/acme', 'abc1234/../..', '', 'abc 1234']) {
      await expect(
        backend.checkout({ gitUrl: 'https://github.com/acme/crm.git', gitSha }),
      ).rejects.toThrow(/kein Commit-Hash/);
    }
    expect(urls).toEqual([]);
  });

  it('nennt den Grund, wenn der Commit nicht zu holen ist', async () => {
    fetchReturning(() => new Response('Not Found', { status: 404 }));

    await expect(
      createGitHubRepositoryBackend(config).checkout({
        gitUrl: 'https://github.com/acme/crm.git',
        gitSha: 'abc1234',
      }),
    ).rejects.toThrow(/gepusht/);
  });

  it('weist ein zu grosses Archiv ab', async () => {
    const bytes = archive();
    fetchReturning(() => new Response(bytes, { status: 200 }));

    await expect(
      createGitHubRepositoryBackend({ ...config, checkoutMaxBytes: 10 }).checkout({
        gitUrl: 'https://github.com/acme/crm.git',
        gitSha: 'abc1234',
      }),
    ).rejects.toThrow(/GITHUB_CHECKOUT_MAX_BYTES/);
  });
});

describe('Repo-URL zu owner/name', () => {
  it('liest die ueblichen Formen', () => {
    expect(repositorySlug('https://github.com/acme/crm.git')).toBe('acme/crm');
    expect(repositorySlug('https://github.com/acme/crm')).toBe('acme/crm');
    expect(repositorySlug('git@github.com:acme/crm.git')).toBe('acme/crm');
  });

  it('weist alles ab, was einen weiteren Pfad in die API schmuggeln wuerde', () => {
    for (const url of [
      'https://github.com/acme/crm/../../orgs/acme',
      'https://github.com/acme',
      'acme/crm',
      'https://github.com/acme/crm?x=1',
    ]) {
      expect(() => repositorySlug(url)).toThrow(/keine Repo-URL/);
    }
  });
});
