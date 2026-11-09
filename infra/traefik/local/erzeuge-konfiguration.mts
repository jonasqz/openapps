/**
 * Erzeugt `local/dynamic/openapps.yaml` fuer den lokalen Nachweis — mit dem
 * **echten** Generator der Control Plane, nicht mit einer Kopie von Hand.
 *
 * Das ist der Punkt des ganzen Aufbaus: Der lokale Lauf prueft die
 * Konfiguration, die im Betrieb entsteht (ADR 0008). Ein handgeschriebenes
 * YAML haette bewiesen, dass Traefik tut, was in der Datei steht — nicht, dass
 * in der Datei steht, was der Generator schreibt.
 *
 * Lauf: `./local/konfiguration-erzeugen.sh` (buendelt mit esbuild und fuehrt
 * das Ergebnis aus — der direkte Weg ueber `tsx` scheitert hier an `pg`, das
 * aus `@openapps/sdk` kommt und als CJS keine benannten ESM-Exporte hat).
 *
 * Unterschied zum Betrieb: `certResolver: null` (Let's Encrypt kann fuer
 * `.local.test` kein Zertifikat ausstellen; das Standard-Zertifikat kommt aus
 * `local/tls.local.yml`) und `.local.test`-Adressen statt der echten Domain.
 * Alles andere — Router, Dienste, Middlewares, Catch-all, Reihenfolge — ist
 * Zeile fuer Zeile das, was auf dem Host landet.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { buildGatewayConfig } from '../../../apps/control-plane/src/domain/gateway-config';
import { renderGatewayConfig } from '../../../apps/control-plane/src/infra/gateway-config-store';

/** Die Apps des lokalen Stapels. `ohne-router` steht absichtlich nicht hier. */
const lokal = {
  appsDomain: 'intern.local.test',
  apps: [
    { appName: 'app1', port: 8000 },
    { appName: 'app2', port: 8000 },
  ],
  forwardAuthAddress: 'http://openapps-control-plane:3000/api/authz/forward',
  denyBackendUrl: 'http://openapps-deny-backend:8080',
  // Coolifys Entrypoint-Name. Der lokale Traefik wird mit denselben Namen
  // gestartet (siehe `docker-compose.yml`).
  entryPoint: 'https',
  certResolver: null,
  controlPlane: {
    host: 'control-plane.local.test',
    url: 'http://openapps-control-plane:3000',
  },
} as const;

/**
 * Dieselbe Rechnung mit den Werten, die auf einem Host gelten — fuer
 * `../dynamic/openapps.example.yaml`. Zweites Argument `beispiel`.
 */
const beispiel = {
  ...lokal,
  appsDomain: 'intern.example.com',
  apps: [
    { appName: 'projektliste', port: 3000 },
    { appName: 'crm', port: 8080 },
  ],
  certResolver: 'letsencrypt',
  controlPlane: {
    host: 'control-plane.example.com',
    url: 'http://openapps-control-plane:3000',
  },
} as const;

const config = buildGatewayConfig(process.argv[3] === 'beispiel' ? beispiel : lokal);

async function main(): Promise<void> {
  const target = process.argv[2];
  if (target === undefined) {
    throw new Error('Aufruf: erzeuge-konfiguration <zieldatei>');
  }
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, renderGatewayConfig(config), 'utf8');
  console.log(`geschrieben: ${target}`);
  console.log(`Router: ${Object.keys(config.http.routers).join(', ')}`);
}

void main();
