/**
 * Lebenszeichen für Traefik und den Startup-Check.
 *
 * Bewusst **ohne** Datenbank und ohne Abhängigkeiten: Dieser Pfad steht in der
 * öffentlichen Allowlist der Forward-Auth (Spec 1.3), wird also ohne Session
 * beantwortet. Er sagt genau eine Sache — der Prozess läuft — und verrät
 * nichts darüber, welche Apps es gibt oder wie es ihnen geht. Eine Prüfung,
 * die die Datenbank anfasst, wäre ein ungeprüfter Pfad in die Datenbank.
 */
export const dynamic = 'force-dynamic';

export function GET(): Response {
  return new Response('ok\n', {
    status: 200,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
