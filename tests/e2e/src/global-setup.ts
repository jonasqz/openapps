/**
 * Bricht frueh und mit klarer Meldung ab, wenn der Stapel nicht laeuft. Sonst
 * scheitert jeder Test einzeln an einer Zeitueberschreitung.
 */

import { ADMIN_URL, MCP_URL, VIEW_URL, operatorToken, operatorTokenModeOk } from './stack';
import { gatewayGet } from './gateway';

async function reachable(url: string): Promise<boolean> {
  try {
    await fetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(5_000) });
    return true;
  } catch {
    return false;
  }
}

export default async function globalSetup(): Promise<void> {
  const missing: string[] = [];
  for (const [label, url] of [
    ['apps viewing proxy', VIEW_URL],
    ['admin viewing proxy', ADMIN_URL],
    ['platform MCP', MCP_URL],
  ] as const) {
    if (!(await reachable(url))) missing.push(`${label} (${url})`);
  }
  try {
    await gatewayGet('/');
  } catch {
    missing.push('gateway (https://127.0.0.1:8443)');
  }
  if (missing.length > 0) {
    throw new Error(
      `Local stack not reachable: ${missing.join(', ')}. Start it with ./infra/lokal/lokal.sh up -d (first time: ./infra/lokal/einrichten.sh and ./infra/lokal/apps-ausrollen.sh).`,
    );
  }
  // Wirft mit Dateiname, ohne Inhalt, wenn das Token fehlt.
  operatorToken();
  if (!operatorTokenModeOk()) {
    throw new Error('infra/lokal/.agents/operator.token is readable by others; chmod 600 it.');
  }
}
