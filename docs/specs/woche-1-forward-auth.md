# Spec Woche 1: Forward-Auth und Default-Deny

Stand 2026-11-09 · Status: Entwurf, umsetzbar

Diese Spec deckt die größte Annahme des Projekts ab: Die Auth über Traefik
bleibt bei Coolify-Updates stabil. Nachweis ist DoD 2.

## 1. Was gebaut wird

Vor jeder App-Domain steht eine Forward-Auth-Prüfung. Traefik fragt pro Aufruf
die Control Plane. Nur eine 2xx-Antwort lässt den Aufruf weiter.

Bausteine:

| Baustein | Ort | Aufgabe |
| --- | --- | --- |
| Auth-Endpunkt | `apps/control-plane`, `GET /api/authz/forward` | Entscheidet pro Aufruf, setzt die Identitäts-Header |
| Traefik-Konfiguration | `infra/traefik/` | Middleware am Entrypoint, Catch-all-Router, Timeouts |
| Deny-Backend | `infra/traefik/` | Antwortet auf alles Unbekannte mit 403 |
| Label-Setter | `apps/control-plane/src/adapters/coolify` | Setzt pro App Router, Host-Regel und Middleware |
| Label-Lint | Control Plane, vor und nach jedem Deploy | Prüft, dass die Labels einer App vollständig sind |
| Testskript | `infra/scripts/check-auth.sh` | Nachweis für DoD 2 |

### 1.1 Entscheidung pro Aufruf

Traefik ruft `GET /api/authz/forward` auf und übergibt die
Original-Anfrage über `X-Forwarded-Host`, `X-Forwarded-Uri`,
`X-Forwarded-Method` und die Cookies des Nutzers.

Der Endpunkt prüft in dieser Reihenfolge:

1. Ist der Host eine in der Control Plane registrierte App-Domain? Nein → 403.
2. Ist die angefragte Route eine öffentliche Ausnahme (siehe 1.3)? Ja → 200.
3. Gibt es eine gültige Better-Auth-Session? Nein → 302 auf den Login.
4. Hat der Nutzer eine Freigabe auf diese App (direkt oder über Gruppe)?
   Nein → 403.
5. Sonst 200 mit den Identitäts-Headern aus Abschnitt 3.

Keine Antwort wird zwischengespeichert. Widerruf wirkt beim nächsten Aufruf.
Das folgt dem Default-Deny aus `docs/01-architektur.md`.

### 1.2 Default-Deny ist kein Label

Die Middleware hängt am **Entrypoint**, nicht an den Labels der App. In der
statischen Traefik-Konfiguration:
`entryPoints.websecure.http.middlewares = ["openapps-forward-auth@file"]`.

Damit gilt sie für jeden Router auf diesem Entrypoint, auch für Router, die
Coolify selbst anlegt. Ein App-Label ist dann nicht die Quelle des Schutzes,
sondern nur die Zuordnung Host → Container.

Zusätzlich liegt ein Catch-all-Router mit `rule: HostRegexp(...)`,
`priority: 1` und dem Deny-Backend auf demselben Entrypoint. Jeder Host ohne
eigenen Router landet dort und bekommt 403.

Beides zusammen ist die Antwort auf die Fehlerfälle in Abschnitt 2.

### 1.3 Öffentliche Ausnahmen

Die Control Plane steht hinter derselben Middleware. Sonst entsteht ein Kreis:
Die Auth-Prüfung bräuchte eine Auth-Prüfung.

Die Ausnahmen stehen **im Code des Auth-Endpunkts**, nicht in der Traefik-
Konfiguration: Host der Control Plane plus Pfad-Allowlist
(`/login`, `/api/auth/*`, `/api/authz/forward`, `/healthz`, `/_next/static/*`).
Alles andere auf diesem Host braucht eine Session.

Begründung: Eine Konfigurationszeile kann ein Coolify-Update überschreiben.
Eine Zeile im Code der Control Plane nicht. Verworfene Alternative: einen
zweiten Entrypoint ohne Middleware für die Control Plane — verworfen, weil dann
ein falsch gesetztes Label eine App auf den ungeschützten Entrypoint legen
kann.

## 2. Fehlerfälle und das richtige Verhalten

Die Regel für jede Zeile: Im Zweifel geschlossen. Ein 500 ist besser als ein
ungeschütztes 200.

| Fall | Richtiges Verhalten | Wie es durchgesetzt wird |
| --- | --- | --- |
| Control Plane nicht erreichbar (Container aus, Deploy, Neustart) | Kein Durchlass. Traefik antwortet 502/500 für alle App-Domains | Traefik-Standard bei fehlgeschlagenem Forward-Auth ist kein Durchlass. Es gibt keine Option, die das aufweicht, und es wird keine gesetzt |
| Control Plane antwortet langsam | Abbruch nach 2 s, dann wie „nicht erreichbar“ | `forwardAuth` mit kurzem Transport-Timeout; die Prüfung ist eine lokale Session- und Grant-Abfrage und bleibt weit darunter |
| Control Plane antwortet 5xx oder ungültig | Kein Durchlass | Nur 2xx gilt als Freigabe. 3xx wird an den Client weitergegeben (Login), alles andere sperrt |
| Coolify-Update entfernt oder überschreibt App-Labels | App ist nicht mehr erreichbar, aber nie ungeschützt. Ohne Router greift der Catch-all mit 403 | Entrypoint-Middleware plus Catch-all-Router |
| Coolify-Update überschreibt die **statische** Traefik-Konfiguration | Lauter Fehler, nicht stiller Durchlass. Das Testskript schlägt an, die Konfiguration wird aus `infra/traefik/` neu ausgerollt | `check-auth.sh` läuft nach jedem Update; zusätzlich ein Startup-Check der Control Plane gegen die Traefik-API (`/api/entrypoints`), der bei fehlender Middleware einen Alarm schreibt |
| Neue App-Domain noch ohne Label | 403 durch den Catch-all. Die Domain wird erst erreichbar, wenn Router **und** Registrierung in der Control Plane stehen | Catch-all-Router plus Schritt 1 der Prüfkette (unbekannter Host → 403) |
| Middleware-Reihenfolge vertauscht | Nicht möglich zu umgehen. Die Entrypoint-Kette läuft vor jeder Router-Middleware | Entrypoint-Middleware; der Label-Lint blockiert zusätzlich Router, die eigene Middleware vor die Auth setzen wollen |
| App-Container direkt erreichbar (Port veröffentlicht, falsches Docker-Netz) | Deploy wird blockiert | Label-Lint prüft: keine `ports`-Veröffentlichung, nur das Gateway-Netz. Siehe Annahme in Abschnitt 3.3 |

Ausdrücklich nicht vorgesehen: ein Not-Schalter, der die Auth überspringt, und
ein „fail open“-Modus für Wartungsfenster.

## 3. Header und was die App ihnen glauben darf

### 3.1 Was das Gateway setzt

Die Control Plane gibt bei 200 diese Header zurück, Traefik kopiert genau
diese über `authResponseHeaders`:

| Header | Inhalt |
| --- | --- |
| `X-Auth-User-Id` | Stabile ID des Nutzers |
| `X-Auth-User-Email` | E-Mail aus dem Google-SSO |
| `X-Auth-Groups` | Gruppen, kommagetrennt |
| `X-Auth-Issued-At` | Unix-Zeit der Entscheidung |
| `X-Auth-Signature` | HMAC-SHA256 über die vier Werte oben plus Host und App-ID |

Alle sechs Header werden **immer** gesetzt, auch bei leeren Werten. Sonst
reicht Traefik einen vom Client mitgeschickten Header unverändert durch.

### 3.2 Was die App prüft

Die App liest die Header nur über `@openapps/sdk` (Regel 1 aus `AGENTS.md`).
Das SDK verwirft den Aufruf, wenn eine der Bedingungen verletzt ist:

1. `X-Auth-Signature` passt zum HMAC über die übrigen Werte, berechnet mit dem
   App-eigenen Secret aus der Env (`OPENAPPS_AUTH_SECRET`).
2. `X-Auth-Issued-At` liegt höchstens 60 s zurück und nicht in der Zukunft.
3. Der im Signatur-Material enthaltene Host passt zur eigenen App-Domain.

Ein Angreifer, der die Header selbst setzt, kann die Signatur nicht erzeugen.
Er kennt das Secret nicht: Es wird pro App von der Control Plane erzeugt und
nur als Env-Variable in diese App und ins Gateway gegeben. Eine abgefangene
gültige Signatur ist nach 60 s wertlos und gilt nur für diese Domain.

### 3.3 Welche Annahme das an die Infrastruktur stellt

Das Modell hält nur, solange der App-Container ausschließlich über das Gateway
erreichbar ist. Konkret:

- Kein veröffentlichter Host-Port am App-Container.
- App und Traefik im gemeinsamen Docker-Netz, die App in keinem weiteren.
- Das App-Secret liegt nur in Gateway und App, nicht in Logs, nicht im Repo.

Diese drei Punkte prüft der Label-Lint vor jedem Deploy. Fällt einer, blockiert
das Review-Gate. Die Annahme steht hier offen, weil sie nicht durch die App
abgesichert werden kann, sondern nur durch die Plattform.

## 4. Nachweis für DoD 2: `infra/scripts/check-auth.sh`

### 4.1 Was das Skript tut

Aufruf: `check-auth.sh --phase before|after [--domain <host>]`.

1. Domains holen: alle registrierten App-Domains über
   `GET /api/apps` der Control Plane, plus die Domain der Control Plane, plus
   eine absichtlich **nicht** registrierte Testdomain auf demselben Wildcard.
2. Für jede Domain ohne Cookie: `GET /`, `GET /api/health`, `GET /admin`
   (ein Pfad, der in der App existiert, und zwei, die es nicht müssen).
   `curl` ohne Redirect-Folgen, Timeout 5 s.
3. Zusätzlich je Domain ein Aufruf mit selbst gesetzten Headern
   (`X-Auth-User-Id: eve`, `X-Auth-Signature: x`), um 3.2 zu prüfen.
4. Fehlerfall-Prüfung: Control Plane anhalten, alle Domains erneut aufrufen,
   Control Plane starten. Nur im Testlauf, nicht im Dauerbetrieb.
5. Ergebnis als Zeile pro Domain und Pfad in
   `docs/nachweise/dod-02-laeufe/<datum>-<phase>.txt`, Exit-Code 1 bei jedem
   Verstoß.

### 4.2 Erwartung pro Domain

| Domain | Ohne Session erwartet |
| --- | --- |
| Registrierte App-Domain | 302 auf den Login oder 401/403. Kein 200, kein App-Inhalt im Body |
| Nicht registrierte Domain auf dem Wildcard | 403 vom Deny-Backend |
| Control Plane, `/login` und `/api/auth/*` | 200 |
| Control Plane, alles andere | 302 oder 401/403 |
| Jede App-Domain mit selbst gesetzten Auth-Headern | 302 oder 401/403, nie 200 |
| Alle App-Domains, Control Plane angehalten | 502 oder 500, nie 200 |

Zusätzlich geprüft: Der Body eines 403 enthält keinen App-Inhalt, und die
Antwort trägt keinen `Set-Cookie` der App.

### 4.3 Wie das Coolify-Update im Test ausgelöst wird

Das Update wird echt ausgeführt, nicht simuliert. Ablauf:

1. `check-auth.sh --phase before`, Ergebnis ablegen.
2. Traefik-Konfiguration und Coolify-Version notieren
   (`docker inspect` der Traefik-Instanz, Coolify-Versionsanzeige).
3. Coolify über seinen eigenen Weg aktualisieren: Update im Coolify-UI oder
   `curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash` auf dem
   Host, je nachdem, was die installierte Version vorsieht.
4. Warten, bis Coolify und Traefik wieder laufen. Keine eigene Reparatur
   vorher — der Lauf soll zeigen, was das Update von sich aus tut.
5. `check-auth.sh --phase after`.
6. Beide Ergebnisse und die Diffs der Traefik-Konfiguration ins Protokoll.

Dazu ein zweiter, härterer Lauf: eine frische App über `create_app` anlegen und
**vor** dem Setzen der Labels aufrufen. Erwartung 403.

### 4.4 Signal für „nicht stabil“

Als nicht stabil gilt der Ansatz, wenn eines davon zutrifft:

- Eine App-Domain antwortet in einem der Läufe ohne Session mit 200.
- Die Entrypoint-Middleware fehlt nach dem Update in der laufenden
  Traefik-Instanz.
- Die Wiederherstellung nach dem Update braucht einen manuellen Eingriff, der
  nicht als Skript in `infra/scripts/` steht.
- Der Zustand „ungeschützt erreichbar“ tritt überhaupt auf, auch nur für
  Sekunden während des Updates.

Der letzte Punkt braucht eine Messung, keine Beobachtung: Während des Updates
läuft `check-auth.sh` in einer Schleife im Sekundentakt gegen eine App-Domain
und schreibt jeden Statuscode mit.

## 5. Abbruch-Kriterium

### 5.1 Was am Ende von Woche 1 stehen muss

Alles davon, sonst gilt das Abbruch-Kriterium aus `docs/02-roadmap.md`:

1. `infra/scripts/check-auth.sh` existiert und läuft ohne Handgriffe.
2. Zwei grüne Läufe, vor und nach einem echten Coolify-Update, mit mindestens
   drei App-Domains plus der nicht registrierten Testdomain.
3. Null 200-Antworten ohne Session in beiden Läufen und in der Schleife
   während des Updates.
4. Der Fehlerfall „Control Plane aus“ ist gemessen und sperrt.
5. Der Header-Fälschungs-Test ist gemessen und sperrt.
6. Eine neue App ohne Labels ist gemessen und gibt 403.

### 5.2 Was „Ansatz neu denken“ konkret heißt

Es stehen zwei Alternativen zur Wahl. Entschieden wird am Ende von Woche 1,
als ADR, nicht hier.

**A: Eigener Reverse-Proxy vor Coolify.** Ein von uns verwalteter Traefik oder
Caddy nimmt Port 80/443, terminiert TLS, prüft die Auth und leitet an Coolifys
Traefik weiter.

- Kostet: zweite Proxy-Schicht, eigene Zertifikatsverwaltung, eigenes
  DNS- und Domain-Handling. Coolifys Domain-Funktion wird teilweise
  umgangen, die Adapter-Schicht muss das abbilden.
- Kostet an Prinzipien: nichts. Regel 1 bleibt, Apps bleiben ohne Login-Code.
- Gewinnt: Coolify-Updates können die Auth nicht mehr anfassen. Das ist genau
  die Annahme, die dann gekippt ist.

**B: Auth-Middleware im Starter-Template.** Jede App prüft die Session selbst,
über ein Paket der Plattform.

- Kostet an Prinzipien: Regel 1 aus `AGENTS.md` sagt, Apps enthalten keinen
  Login-Code. B bricht diese Regel. Damit wird jede App zur
  Sicherheitsgrenze, und das Ziel „Gateway prüft jeden Aufruf“ aus
  `docs/01-architektur.md` fällt.
- Kostet technisch: Apps, die nicht aus dem Template kommen, sind ungeschützt.
  Ein Update der Auth-Logik heißt, alle Apps neu deployen. Widerruf wirkt erst
  nach dem nächsten Request der jeweiligen App.
- Gewinnt: unabhängig von Coolify und Traefik.

Richtung, nicht Entscheidung: A hält die Prinzipien, B ist billiger. Kippt die
Annahme, wird A bevorzugt, und B nur, wenn A an der Coolify-Integration
scheitert. Wer B wählt, muss `AGENTS.md` Regel 1 und
`docs/01-architektur.md` ändern — als benannte Änderung, nicht stillschweigend.

## 6. Nicht in dieser Spec

- Rechte zwischen Apps und DB-Rollen (Woche 2, DoD 3).
- Agent-Identität und MCP-Rechte (Woche 3, DoD 6).
- Login-Oberfläche und Gruppenpflege in der Control Plane, über das für die
  Prüfung Nötige hinaus.
