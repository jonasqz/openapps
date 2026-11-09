/**
 * Was beim Start der Control Plane einmal laeuft.
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

export async function register(): Promise<void> {
  // Nur im Node-Runtime: Der Check spricht HTTP mit einem internen Dienst und
  // hat im Edge-Runtime nichts zu suchen.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { runGatewayStartupCheck } = await import('./infra/gateway-guard');
  void runGatewayStartupCheck().catch((cause: unknown) => {
    console.warn(
      `WARN Startup-Check des Gateways abgebrochen: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  });
}
