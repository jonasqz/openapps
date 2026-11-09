/**
 * Der MCP-Prompt `how_to_build_app` liefert den Inhalt von `AGENTS.md`.
 *
 * Damit bekommt jeder Agent, der ueber diesen Server arbeitet, dieselben Regeln
 * wie ein Agent in Claude Code — eine Quelle, keine Kopie. Die Datei wird bei
 * jedem Aufruf gelesen, damit eine Aenderung an `AGENTS.md` sofort gilt.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const HOW_TO_BUILD_APP = 'how_to_build_app';

export const HOW_TO_BUILD_APP_DESCRIPTION =
  'Die Regeln der Plattform fuer Agents, die eine App bauen: Login ueber Header, eigenes Schema, API vor UI, Manifest pflegen, keine Secrets, nur das Design System, nichts am Gateway vorbei.';

/**
 * Sucht `AGENTS.md` ueber `AGENTS_MD_PATH` oder von hier aus nach oben. Die
 * Suche endet am Dateisystem-Wurzelverzeichnis; dann gibt es einen Fehler und
 * keinen stillen Platzhalter.
 */
export async function readAgentsMd(options?: {
  explicitPath?: string | undefined;
  startDir?: string;
}): Promise<string> {
  const explicit = options?.explicitPath ?? process.env.AGENTS_MD_PATH;
  if (explicit !== undefined && explicit !== '') {
    return readFile(explicit, 'utf8');
  }

  let dir = options?.startDir ?? process.cwd();
  for (;;) {
    try {
      return await readFile(path.join(dir, 'AGENTS.md'), 'utf8');
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) {
        throw new Error('AGENTS.md nicht gefunden. Setze AGENTS_MD_PATH auf den Pfad der Datei.');
      }
      dir = parent;
    }
  }
}
