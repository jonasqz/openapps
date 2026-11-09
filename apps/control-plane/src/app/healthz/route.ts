/**
 * Lebenszeichen für Traefik und den Startup-Check.
 *
 * Bewusst **ohne** Datenbank und ohne Abhängigkeiten: Dieser Pfad steht in der
 * öffentlichen Allowlist der Forward-Auth (Spec 1.3), wird also ohne Session
 * beantwortet. Er sagt genau eine Sache — der Prozess läuft — und verrät
 * nichts darüber, welche Apps es gibt oder wie es ihnen geht. Eine Prüfung,
 * die die Datenbank anfasst, wäre ein ungeprüfter Pfad in die Datenbank.
 */
import { platformAlarms } from '../../infra/alarms';
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
  // Dazu die Befunde des Label-Lints nach dem Deploy (eine Zeile pro App).
  // Auch sie bleiben ein 200: Der Grund steht bei `createAlarmSink`.
  const alarms = platformAlarms();

  const lines = [
    'ok',
    ...(problems === undefined ? [] : [`gateway: ALARM ${problems.join(' | ')}`]),
    ...alarms.map((alarm) => `${alarm.kind} ${alarm.subject}: ALARM ${alarm.problems.join(' | ')}`),
  ];
  const alarming = problems !== undefined || alarms.length > 0;

  return new Response(`${lines.join('\n')}\n`, {
    status: 200,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      ...(alarming ? { 'x-openapps-gateway': 'alarm' } : {}),
    },
  });
}
