/**
 * Lebenszeichen für Traefik und den Startup-Check.
 *
 * Bewusst **ohne** Datenbank und ohne Abhängigkeiten: Dieser Pfad steht in der
 * öffentlichen Allowlist der Forward-Auth (Spec 1.3), wird also ohne Session
 * beantwortet. Er sagt genau eine Sache — der Prozess läuft — und verrät
 * nichts darüber, welche Apps es gibt oder wie es ihnen geht. Eine Prüfung,
 * die die Datenbank anfasst, wäre ein ungeprüfter Pfad in die Datenbank.
 */
import { gatewayAlarm } from '../../infra/gateway-guard';

export const dynamic = 'force-dynamic';

export function GET(): Response {
  // Der Alarm des Startup-Checks wird hier sichtbar, aber der Status bleibt
  // 200. Ein 503 waere hier die falsche Reaktion: Es ist der Orchestrator, der
  // einen roten Healthcheck beantwortet, indem er den Container neu startet —
  // und eine nicht antwortende Control Plane sperrt ueber die Forward-Auth
  // jede Domain, auch den Login, ueber den die Konfiguration repariert wird
  // (Nachweis Fall 7). Begruendung ausfuehrlich bei `runGatewayStartupCheck`.
  const problems = gatewayAlarm();
  const body = problems === undefined ? 'ok\n' : `ok\ngateway: ALARM ${problems.join(' | ')}\n`;

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      ...(problems === undefined ? {} : { 'x-openapps-gateway': 'alarm' }),
    },
  });
}
