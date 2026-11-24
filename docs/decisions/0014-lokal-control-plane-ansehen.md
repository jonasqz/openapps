# ADR 0014: Lokal die Control Plane ansehen, als Admin oder als Nutzer

Stand: 24.11.2026

## Kontext

Die Verwaltung (Apps, Agents, Freigaben) hat eine Oberfläche in der Control
Plane. Lokal war sie nicht zu sehen, weil sie eine Session von Better Auth
braucht und es die nur über Google gibt (ADR 0013, Folgen). Deshalb hatte sie
nach dem Umbau nie jemand geprüft, weder das neue Design (ADR 0010) noch, was
ein Mensch ohne Freigaben dort sieht.

## Entscheidung

Der Ansehen-Proxy aus ADR 0013 bekommt einen zweiten Port, `127.0.0.1:8091`,
für die Control Plane (`apps/control-plane/src/infra/lokal-ansehen-cp.ts`).

- **Session über Better Auth, nicht daneben.** Der Proxy legt Nutzer und
  Session mit `internalAdapter` an. Dabei laufen dieselben Hooks wie nach
  einem Google-Login: die Domain-Schranke und die Bootstrap-Gruppe. Es fällt
  nur der Schritt bei Google weg.
- **Zwei Rollen.**
  - `admin` ist der erste Eintrag aus `AUTH_BOOTSTRAP_ADMINS` und landet über
    den Hook in `platform-admins`.
  - `nutzer` ist `nutzer@<erste erlaubte Domain>`, ohne Gruppe und ohne
    Freigabe.
  - Gewechselt wird über `/_lokal/als/admin` und `/_lokal/als/nutzer`.
- **Das Session-Cookie bleibt drinnen.** Der Browser bekommt nur ein Cookie
  mit dem Namen der Rolle. Die signierte Session hängt der Proxy an die
  Anfrage nach innen, und Cookies aus der Antwort gibt er nicht heraus.
- **Schreiben nur von der eigenen Adresse.** Weil jede Anfrage an 8091
  angemeldet ist, lehnt der Proxy schreibende Anfragen (alles außer GET, HEAD
  und OPTIONS) ab, wenn sie nicht von `127.0.0.1:8091` oder `localhost:8091`
  kommen. Eine fremde Seite im Browser kann so keine Freigabe vergeben.
- Wie in ADR 0013 gilt: eigenes Compose-Profil, nur Loopback, Start nur mit
  `OPENAPPS_BACKEND=lokal`. Die Control Plane selbst bekommt keinen weiteren
  Login, `src/lib/auth.ts` bleibt unverändert.

## Folgen

- Die ganze Verwaltung ist lokal sichtbar und bedienbar, und der Blick als
  `nutzer` zeigt, ob Default-Deny auch in der Oberfläche greift.
- Der Proxy braucht `BETTER_AUTH_SECRET`. Wer es hat, kann ohnehin Sessions
  signieren. Neu ist nur, dass es bequem geht, und nur lokal.
- Die Signatur des Cookies baut der Proxy wie better-call
  (`token.base64(HMAC-SHA256)`). Ändert Better Auth das Format, schlägt der
  Postgres-Test fehl, der die Session durch das echte `getSession` schickt.
- Tests: `tests/lokal-ansehen-cp.spec.ts`. Geprüft wird gegen Postgres:
  - Better Auth nimmt die Session an.
  - Der Admin ist in `platform-admins`, der Nutzer in keiner Gruppe.
  - Eine falsch signierte Session und eine fremde Domain werden abgelehnt.
  - Eine schreibende Anfrage von fremder Herkunft kommt nicht durch.
  - Weder Cookies noch Identität des Browsers gehen nach innen.

## Alternativen

- **Dev-Login in Better Auth** (Passwort oder Magic Link bei
  `OPENAPPS_BACKEND=lokal`): Das wäre ein zweiter Login-Weg im Code, der auch
  auf dem Server läuft. Verworfen wie in ADR 0013.
- **Sessions per SQL in die Tabelle schreiben**: Das umgeht die Hooks und
  damit Domain-Schranke und Bootstrap-Gruppe. Verworfen.
- **Eigene Google-Zugangsdaten**: Das bleibt der Weg für den echten Login.
  Für eine zweite Rolle bräuchte man damit aber ein zweites Google-Konto, und
  automatisch prüfen ließe es sich nicht.
