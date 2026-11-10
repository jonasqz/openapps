/**
 * Was beim Start der Control Plane einmal laeuft: erst die eigene
 * Traefik-Datei schreiben, dann pruefen, was Traefik daraus macht.
 *
 * Next ruft `register()` genau einmal pro Serverprozess, bevor der erste
 * Request bedient wird. Hier haengt der Startup-Check gegen die Traefik-API
 * (`src/infra/gateway-guard.ts`): Ein Coolify-Update kann die statische
 * Traefik-Konfiguration ersetzen und damit die Forward-Auth vom Entrypoint
 * nehmen, ohne dass irgendwo ein Fehler entsteht.
 *
 * Der Check wird **nicht** abgewartet: Der Prozess startet, auch wenn die
 * Traefik-API langsam ist. Was bei Alarm passiert und warum nicht mehr, steht
 * bei `runGatewayStartupCheck`.
 */

/** Wie lange Traefiks File-Provider (`watch`) bekommt, die neue Datei zu lesen. */
const TRAEFIK_RELOAD_GRACE_MS = 3000;

export async function register(): Promise<void> {
  // Nur im Node-Runtime: Der Check spricht HTTP mit einem internen Dienst und
  // hat im Edge-Runtime nichts zu suchen.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Nicht abgewartet: Der Prozess startet, auch wenn Datenbank oder Traefik
  // langsam sind.
  void startGateway();
}

async function startGateway(): Promise<void> {
  // 1. Die eigene Traefik-Datei schreiben (ADR 0008). Ohne sie hat die
  //    Control Plane auf einem frischen Server keinen Router — und damit
  //    keinen erreichbaren Login. Scheitert das, bleibt alles zu (es gibt
  //    keinen Router ohne unsere Middlewares), aber es muss laut sein.
  try {
    const { domainContext } = await import('./lib/runtime');
    const { publishGatewayAtStartup } = await import('./domain');
    const config = await publishGatewayAtStartup(domainContext());
    console.info(
      `Gateway-Konfiguration geschrieben: ${String(Object.keys(config.http.routers).length)} Router.`,
    );
    await new Promise((resolve) => setTimeout(resolve, TRAEFIK_RELOAD_GRACE_MS));
  } catch (cause) {
    console.error(
      `ALARM Gateway-Konfiguration beim Start nicht geschrieben: ${errorText(cause)} — ` +
        'die Control Plane ist ueber Traefik nicht erreichbar. Mount von ' +
        '/data/coolify/proxy/dynamic und Schreibrechte pruefen (infra/betrieb/README.md).',
    );
  }

  // 2. Messen, was Traefik daraus gemacht hat.
  const { runGatewayStartupCheck } = await import('./infra/gateway-guard');
  await runGatewayStartupCheck().catch((cause: unknown) => {
    console.warn(`WARN Startup-Check des Gateways abgebrochen: ${errorText(cause)}`);
  });
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
