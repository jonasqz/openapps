/**
 * Der einzige Ausgang des Adapters. Wer von hier importiert, bekommt ein
 * `RepositoryBackend` — keinen Anbieternamen.
 */

import { createGitHubRepositoryBackend } from './client';
import { gitHubConfigFromEnv } from './config';
import type { RepositoryBackend } from '../../domain/ports';

/** Einstieg fuer die Zusammensetzung in `src/lib/runtime.ts`. */
export function createConfiguredRepositoryBackend(): RepositoryBackend {
  return createGitHubRepositoryBackend(gitHubConfigFromEnv());
}

export { createGitHubRepositoryBackend, repositorySlug } from './client';
export { gitHubConfigFromEnv, type GitHubConfig } from './config';
