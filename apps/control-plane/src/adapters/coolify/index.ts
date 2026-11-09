/**
 * Der einzige Ausgang des Adapters. Wer von hier importiert, bekommt ein
 * `DeploymentBackend` — keinen Coolify-Begriff.
 */

import { createCoolifyBackend } from './client';
import { coolifyConfigFromEnv } from './config';
import type { DeploymentBackend } from '../../domain/ports';

/**
 * Der Einstieg fuer die Zusammensetzung in `src/lib/runtime.ts`. Absichtlich
 * neutral benannt: so steht der Name des Anbieters nur in diesem Ordner, und
 * ein Austausch bleibt eine Aenderung an einem Ordner.
 */
export function createConfiguredBackend(): DeploymentBackend {
  return createCoolifyBackend(coolifyConfigFromEnv());
}

export { createCoolifyBackend } from './client';
export { coolifyConfigFromEnv, type CoolifyConfig } from './config';
export { forwardAuthLabels, missingForwardAuthLabels, type ForwardAuthLabelInput } from './traefik';
