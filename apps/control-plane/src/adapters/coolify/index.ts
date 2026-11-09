/**
 * Der einzige Ausgang des Adapters. Wer von hier importiert, bekommt ein
 * `DeploymentBackend` — keinen Coolify-Begriff.
 */

import { createCoolifyBackend } from './client';
import { coolifyConfigFromEnv } from './config';
import { createTraefikLabelLint } from './traefik';
import type { DeploymentBackend, GatewayLabelLint } from '../../domain/ports';

/**
 * Der Einstieg fuer die Zusammensetzung in `src/lib/runtime.ts`. Absichtlich
 * neutral benannt: so steht der Name des Anbieters nur in diesem Ordner, und
 * ein Austausch bleibt eine Aenderung an einem Ordner.
 */
export function createConfiguredBackend(): DeploymentBackend {
  return createCoolifyBackend(coolifyConfigFromEnv());
}

/**
 * Der Label-Lint fuer die Domaene. Er rechnet nur — er ruft das Backend nicht
 * — und bekommt die eine Zahl, die er von aussen braucht: die Adresse, die in
 * die Labels geschrieben wird.
 */
export function createConfiguredGatewayLabelLint(): GatewayLabelLint {
  return createTraefikLabelLint(coolifyConfigFromEnv().forwardAuthUrl);
}

export { createCoolifyBackend, parseCoolifyLabels } from './client';
export { coolifyConfigFromEnv, type CoolifyConfig } from './config';
export {
  createTraefikLabelLint,
  forwardAuthLabels,
  inspectForwardAuthLabels,
  missingForwardAuthLabels,
  type ForwardAuthLabelInput,
} from './traefik';
