/**
 * Auf welchem Port im Container eine App lauscht.
 *
 * Warum das hier steht und nicht im Adapter: Der Port ist eine Eigenschaft der
 * App, kein Coolify-Begriff und kein Traefik-Begriff. Der
 * Konfigurations-Generator (`domain/gateway-config.ts`) schreibt ihn in die
 * Adresse des Dienstes (`http://<netz-alias>:<port>`).
 *
 * Ohne ihn gibt es keine Adresse: In unserer eigenen Konfiguration gibt es
 * keine `EXPOSE`-Heuristik, auf die Traefik zurueckfallen koennte. Ein
 * falscher Port macht die App kaputt (nicht unsicher — die Forward-Auth haengt
 * am Router davor).
 *
 * Die Quelle ist eine **Konvention mit Default 3000**, die das
 * Starter-Template von sich aus bedient (`next start` lauscht auf 3000);
 * abweichen kann eine App, indem sie im Manifest eine Env-Variable `PORT` mit
 * `default` deklariert. Begruendung der Wahl: Das Manifest-Schema liegt in
 * `@openapps/app-manifest` und bekommt fuer diesen einen Zahlenwert kein neues
 * Feld, solange `env` mit `default` ihn schon tragen kann — und eine App, die
 * den Port aendert, muss ihn ohnehin als Env deklarieren, damit ihr Prozess
 * ihn kennt.
 */

import { ConflictError } from './errors';
import type { App } from './types';

/** Der Port, auf dem jede App aus dem Starter-Template lauscht. */
export const DEFAULT_APP_PORT = 3000;

/** Name der Env-Variable, mit der eine App von der Konvention abweicht. */
const PORT_ENV_NAME = 'PORT';

export function appContainerPort(app: Pick<App, 'name' | 'manifest'>): number {
  const declared = (app.manifest.env ?? []).find((entry) => entry.name === PORT_ENV_NAME);
  if (declared?.default === undefined || declared.default.trim() === '') {
    return DEFAULT_APP_PORT;
  }

  const parsed = Number(declared.default.trim());
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    // Kein stilles Zurueckfallen auf 3000: Ein Tippfehler im Manifest wuerde
    // sonst erst beim ersten Aufruf der Domain auffallen, und dann als
    // "Gateway kaputt" und nicht als "Manifest falsch".
    throw new ConflictError(
      `App "${app.name}" deklariert PORT="${declared.default}" — das ist keine Portnummer zwischen 1 und 65535.`,
    );
  }
  return parsed;
}
