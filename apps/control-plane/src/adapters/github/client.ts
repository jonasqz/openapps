/**
 * `RepositoryBackend` gegen die GitHub-REST-API.
 *
 * Ein neues App-Repo entsteht als Kopie des Starter-Templates
 * (`POST /repos/{template}/generate`). Kein Fork: ein Fork bleibt am Original
 * haengen, eine Kopie nicht — und die App soll ihr eigenes Repo haben.
 *
 * Der Adapter legt **nur** das Repo an. Was darin steht, bestimmt das Template;
 * was damit passiert, bestimmt die Control Plane.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type {
  CreatedRepository,
  NewRepositorySpec,
  RepositoryBackend,
  RepositoryCheckout,
  RepositoryCheckoutRequest,
} from '../../domain/ports';
import type { GitHubConfig } from './config';

interface GitHubRepo {
  readonly clone_url?: string;
  readonly html_url?: string;
  readonly full_name?: string;
  readonly default_branch?: string;
}

export function createGitHubRepositoryBackend(config: GitHubConfig): RepositoryBackend {
  async function call<T>(path: string, init: { method: string; body?: unknown }): Promise<T> {
    const response = await fetch(`${config.apiBaseUrl}${path}`, {
      method: init.method,
      headers: {
        authorization: `Bearer ${config.token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'content-type': 'application/json',
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      // Der haeufigste Fall im Betrieb: der Token hat nicht genug Rechte.
      // Die Meldung sagt das, statt „403" zu sein.
      const hint =
        response.status === 403 || response.status === 404
          ? ' — hat der Token Schreibrecht auf die Organisation und Leserecht auf das Template?'
          : '';
      throw new Error(
        `Repo-Backend antwortete ${String(response.status)}: ${text.slice(0, 500)}${hint}`,
      );
    }
    return (await response.json()) as T;
  }

  return {
    async createFromTemplate(spec: NewRepositorySpec): Promise<CreatedRepository> {
      const created = await call<GitHubRepo>(`/repos/${config.templateRepo}/generate`, {
        method: 'POST',
        body: {
          owner: config.owner,
          name: spec.appName,
          description: `${spec.description} (angelegt von ${spec.requestedBy})`,
          private: config.private,
          include_all_branches: false,
        },
      });

      if (created.clone_url === undefined) {
        throw new Error('Repo-Backend lieferte keine Klon-URL fuer das neue Repo');
      }

      return {
        gitUrl: created.clone_url,
        // Ein frisches Repo hat noch keinen Tag. Der Wert hier ist der
        // Startpunkt; der erste echte Deploy bringt seinen eigenen.
        tag: config.initialTag,
        ...(created.html_url === undefined ? {} : { webUrl: created.html_url }),
      };
    },

    /**
     * Ein Commit als Tarball, entpackt in ein eigenes Temp-Verzeichnis. Kein
     * `git clone`: Der Tarball braucht kein Git im Image, traegt keine
     * Historie und keinen Token in einer Remote-URL.
     */
    async checkout(request: RepositoryCheckoutRequest): Promise<RepositoryCheckout> {
      const slug = repositorySlug(request.gitUrl);
      if (!/^[0-9a-f]{7,40}$/i.test(request.gitSha)) {
        throw new Error(`"${request.gitSha}" ist kein Commit-Hash`);
      }

      const response = await fetch(`${config.apiBaseUrl}/repos/${slug}/tarball/${request.gitSha}`, {
        headers: {
          authorization: `Bearer ${config.token}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(config.checkoutTimeoutMs),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(
          `Repo-Backend lieferte den Commit ${request.gitSha} von ${slug} nicht ` +
            `(${String(response.status)}): ${text.slice(0, 300)} — ist der Commit gepusht, ` +
            'und hat der Token Leserecht auf den Inhalt des Repos?',
        );
      }

      const archive = Buffer.from(await response.arrayBuffer());
      if (archive.byteLength > config.checkoutMaxBytes) {
        throw new Error(
          `der Commit ist als Archiv ${String(archive.byteLength)} Bytes gross, erlaubt sind ` +
            `${String(config.checkoutMaxBytes)} (GITHUB_CHECKOUT_MAX_BYTES)`,
        );
      }

      const root = await mkdtemp(join(tmpdir(), 'openapps-checkout-'));
      const dispose = async (): Promise<void> => {
        await rm(root, { recursive: true, force: true });
      };
      try {
        const file = join(root, 'source.tar.gz');
        const dir = join(root, 'src');
        await writeFile(file, archive);
        // GitHub legt alles unter einen Ordner `<owner>-<repo>-<sha>/`; der
        // faellt weg, damit `app.json` oben liegt.
        await run('mkdir', ['-p', dir]);
        await run('tar', ['-xzf', file, '-C', dir, '--strip-components=1', '--no-same-owner']);
        await rm(file, { force: true });
        return { dir, dispose };
      } catch (cause) {
        await dispose();
        throw cause;
      }
    },
  };
}

const run = promisify(execFile);

/**
 * `owner/name` aus einer Git-URL. Nur diese Form geht an die API — eine URL,
 * die auf einen anderen Host zeigt, wird nicht „irgendwie" aufgeloest.
 */
export function repositorySlug(gitUrl: string): string {
  const match = /^(?:https:\/\/[^/]+\/|git@[^:]+:)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(
    gitUrl.trim(),
  );
  const dots = (part: string | undefined): boolean => part === '.' || part === '..';
  if (
    match === null ||
    match[1] === undefined ||
    match[2] === undefined ||
    dots(match[1]) ||
    dots(match[2])
  ) {
    throw new Error(`"${gitUrl}" ist keine Repo-URL der Form https://host/owner/name(.git)`);
  }
  return `${match[1]}/${match[2]}`;
}
