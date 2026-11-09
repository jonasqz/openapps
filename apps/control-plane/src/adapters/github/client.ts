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

import type { CreatedRepository, NewRepositorySpec, RepositoryBackend } from '../../domain/ports';
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
  };
}
