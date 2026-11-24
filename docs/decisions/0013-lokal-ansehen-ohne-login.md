# ADR 0013: Lokal die Oberflächen ansehen, ohne zweiten Login

Stand: 24.11.2026

## Kontext

Im lokalen Betrieb (ADR 0011) kommen Menschen nur über Google herein, und
dafür braucht es eigene Zugangsdaten. Ohne sie bleiben die Oberflächen der
Apps hinter der Forward-Auth. Deshalb hatte sie nach dem ersten Lauf niemand
gesehen, auch nicht das neue Design (ADR 0010).

`src/lib/auth.ts` sagt: ein Anbieter, Google, kein zweiter Weg herein. Ein
Dev-Login in der Control Plane wäre genau so ein zweiter Weg, im Code, der
auch auf dem Server läuft.

## Entscheidung

Statt eines Logins gibt es einen **Ansehen-Proxy** nur für den lokalen
Betrieb (`apps/control-plane/src/infra/lokal-ansehen.ts`):

- Er ist ein eigener Compose-Dienst im Profil `ansehen` und hängt nur am
  Loopback (`127.0.0.1:8090`).
- Er startet nur mit `OPENAPPS_BACKEND=lokal`.
- Er signiert jede Anfrage als den festen Nutzer `ansicht@local.test`, ohne
  Gruppen, mit derselben Funktion wie Forward-Auth und MCP
  (`identityHeadersForApp`). Dann geht die Anfrage direkt an den Container der
  App.
- Identitäts-Header, Host und Cookies aus dem Browser verwirft er.
- `Origin` schreibt er nur für Anfragen von seiner eigenen Adresse auf die
  Domain der App um, weil Next bei Server Actions prüft, dass Origin und
  `X-Forwarded-Host` passen. Eine fremde Origin geht unverändert durch, und
  Next lehnt sie weiter ab. Eine andere Seite im Browser kann also über den
  Proxy keine Aktion auslösen (am Stapel geprüft: 500 und „does not match“
  im Log).

Die Control Plane selbst bekommt keinen weiteren Login.

## Folgen

- Mit `--profile ansehen` sind die Apps unter `http://127.0.0.1:8090/<app>`
  zu sehen, ohne Google und ohne `/etc/hosts`.
- Der Proxy umgeht die Forward-Auth. Das ist vertretbar, weil er
  Master-Secret und Owner-DSN braucht, und wer beides hat, kann ohnehin jede
  Signatur bilden. Er gehört aber nie auf einen Server. In `infra/betrieb`
  gibt es ihn nicht.
- Was er nicht zeigt: die Oberfläche der Control Plane selbst. Sie braucht
  eine Better-Auth-Session, und die gibt es weiter nur über Google.
- Tests: `tests/lokal-ansehen.spec.ts`. Geprüft wird, dass die App die
  Signatur annimmt, dass fremde Identität verworfen wird, dass der Proxy nur in
  den Pfad der eigenen App weiterleitet, dass nur eigene Anfragen die Origin
  der App bekommen und dass er außerhalb von `lokal` nicht startet.

## Alternativen

- **Dev-Login in Better Auth** (Passwort oder Magic Link nur bei
  `OPENAPPS_BACKEND=lokal`): Das wäre ein zweiter Login-Weg im Code der
  Control Plane, der nur über ein Env-Flag abgeschaltet ist. Verworfen.
- **Eigene Google-Zugangsdaten für alle, die lokal starten**: Das ist richtig
  für den echten Login, aber zu viel Aufwand, nur um eine Oberfläche
  anzusehen. Der Weg bleibt trotzdem offen (`infra/lokal/README.md`).
- **Die Apps mit `next dev` ohne Gateway starten**: Dann prüft das SDK keine
  Signatur, und man sieht nicht, was im Betrieb läuft. Verworfen.
