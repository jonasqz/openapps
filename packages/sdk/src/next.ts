import { headers } from 'next/headers';
import { readShell, type ReadShellOptions, type ShellAppInfo, type ShellData } from './shell.js';

/**
 * Anbindung an Next.js (App Router), als eigener Unterpfad
 * `@openapps/sdk/next` (ADR 0019). Der Kern des SDK bleibt frei von Next:
 * Nur wer diesen Pfad importiert, braucht `next` (optionale peerDependency).
 *
 * Nur in Server-Komponenten (etwa `src/app/layout.tsx`) aufrufen. In einer
 * Client-Komponente bricht schon der Build ab, weil `next/headers` dort
 * nicht geht — so gelangt das Secret der App nie in den Browser.
 */

export {
  APP_BASE_PATH_ENV,
  appBasePath,
  readShell,
  type ReadShellOptions,
  type ShellAppInfo,
  type ShellData,
  type ShellPlatformAppData,
  type ShellPlatformData,
  type ShellUserData,
} from './shell.js';

/**
 * Die Daten der gemeinsamen Leiste fuer die laufende Anfrage:
 *
 * ```tsx
 * import manifest from '../../app.json';
 * const shell = await loadShell(manifest);
 * ```
 *
 * Wirft wegen ungueltiger Header nie (siehe `readShell`): ohne gueltige
 * Identitaet das Skelett, ohne gueltige Navigation nur diese App.
 *
 * `headers()` steht absichtlich nicht in einem try/catch: Next meldet ueber
 * einen Fehler aus `headers()`, dass die Seite dynamisch gerendert werden
 * muss. Wer ihn faengt, bekommt eine statisch gebaute Seite ohne Nutzer.
 */
export async function loadShell(
  app: ShellAppInfo,
  options: ReadShellOptions = {},
): Promise<ShellData> {
  const requestHeaders = await headers();
  return readShell(requestHeaders, app, options);
}
