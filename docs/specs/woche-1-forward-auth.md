# Spec Woche 1: Forward-Auth und Default-Deny

Stand 2026-11-09 · Fassung 2, nach [ADR 0007](../decisions/0007-eine-domain-pfade-statt-subdomains.md)
und [ADR 0008](../decisions/0008-eigene-dynamische-konfiguration.md)

Diese Spec deckt die größte Annahme des Projekts ab: Der Schutz vor den Apps
bleibt bei Coolify-Updates stabil. Nachweis ist DoD 2.

**Was sich mit Fassung 2 geändert hat.** Fassung 1 hängte die Forward-Auth an
Traefiks Entrypoint in der **statischen** Konfiguration und gab jeder App eine
Subdomain. Beides gilt nicht mehr: Apps liegen unter Pfaden einer Domain
(ADR 0007), und die Router stehen in einer dynamischen Datei, die die Control
Plane selbst schreibt (ADR 0008). Die Entscheidungen stehen in den ADRs; hier
stehen die Fehlerfälle und der Nachweis an einem Ort.

## 1. Was gebaut wird

Vor jedem App-Pfad steht eine Forward-Auth-Prüfung. Traefik fragt pro Aufruf
die Control Plane. Nur eine 2xx-Antwort lässt den Aufruf weiter.

Bausteine:

| Baustein | Ort | Aufgabe |
| --- | --- | --- |
| Auth-Endpunkt | `apps/control-plane/src/app/api/authz/forward/route.ts` | Entscheidet pro Aufruf, setzt die Identitäts-Header |
| Konfigurations-Generator | `apps/control-plane/src/domain/gateway-config.ts` | Erzeugt Router, Dienste und die zwei Middlewares; jeder Router trägt die Kette am Typ (1.2) |
| Schreiben und Rücklesen | `apps/control-plane/src/infra/gateway-config-store.ts` | Schreibt `openapps.yaml` atomar ins gemountete `/traefik/dynamic`, auf dem Host `/data/coolify/proxy/dynamic`; `verify` vergleicht die Datei Zeichen für Zeichen mit der erzeugten Fassung |
| Startup-Check | `apps/control-plane/src/infra/gateway-guard.ts` | Fragt die Traefik-API: laufen unsere Router, mit der Kette, `enabled`, Catch-all vorhanden, `forwardedHeaders` am Entrypoint leer |
| Review-Gate-Schritt `gateway-config` | `apps/control-plane/src/domain/review-gate/steps/gateway-config.ts` | Prüft vor dem Deploy, dass sich für diese App eine tragende Konfiguration erzeugen lässt, und die Annahmen aus 3.3, soweit die Arbeitskopie sie beantwortet |
| Deny-Backend | `infra/traefik/deny-backend/` | nginx, antwortet auf alles 403 |
| Lokaler Nachweis-Stapel | `infra/traefik/docker-compose.yml`, `infra/traefik/local/` | Traefik mit Coolifys statischer Form, erzeugte `openapps.yaml`, Stub, Dummy-Apps |
| Beispielausgabe | `infra/traefik/dynamic/openapps.example.yaml` | Zeigt, was der Generator schreibt, ohne ihn zu starten |
| Testskript | `infra/scripts/check-auth.sh` | Nachweis für DoD 2 gegen eine Adressliste |

Eine eigene statische Traefik-Konfiguration gibt es nicht mehr. Entrypoints
(`http`, `https`) und der Resolver `letsencrypt` stehen in Coolifys statischer
Datei; wir verweisen darauf und fassen sie nicht an.

### 1.1 Entscheidung pro Aufruf

Traefik ruft `GET /api/authz/forward` auf und übergibt die Original-Anfrage
über `X-Forwarded-Host`, `X-Forwarded-Uri`, `X-Forwarded-Method` und die
Cookies des Nutzers. Der Rumpf geht nicht mit (`forwardBody: false`).

Der Endpunkt prüft in dieser Reihenfolge:

1. Fehlt der Ziel-Host, gibt es nichts zu entscheiden → 403.
2. Ist der Host der Host der Control Plane, greift die Pfad-Allowlist aus 1.3.
3. Sonst sagt das **erste Pfadsegment**, welche App gemeint ist (ADR 0007:
   eine Domain, ein Pfad je App). Kein Pfadsegment, keine registrierte App,
   eine archivierte App oder eine App, deren Domain nicht dieser Host ist
   → 403. Auch `/` auf der gemeinsamen Domain fällt hierunter.
4. Gibt es eine gültige Better-Auth-Session? Nein → 302 auf den Login.
5. Hat der Nutzer eine Freigabe auf diese App (direkt oder über Gruppe)?
   Nein → 403, mit Eintrag im Audit-Log.
6. Sonst 200 mit den Identitäts-Headern aus Abschnitt 3; der Audit-Eintrag
   steht auch hier.

Jeder Fehler in der Route endet im selben 403. Keine Antwort wird
zwischengespeichert. Widerruf wirkt beim nächsten Aufruf. Das folgt dem
Default-Deny aus `docs/01-architektur.md`.

### 1.2 Default-Deny hängt am Typ des Routers

Es gibt **keine Stelle mehr, die die Forward-Auth global erzwingt** (ADR 0008).
Sie steht in jedem Router, den unser Generator schreibt. Das Default-Deny ist
damit von der Infrastruktur in `domain/gateway-config.ts` gewandert, und dort
hängt es nicht an einer Prüfung, sondern am Typ:

- `GuardedRouter` trägt `middlewares` als Pflichtfeld und als Tupel aus genau
  den zwei Literalen `[openapps-strip-auth-headers, openapps-forward-auth]`.
- Das Brand von `GuardedRouter` liegt unter einem modul-privaten `Symbol`, das
  nicht exportiert wird. Kein anderes Modul — auch kein Test — kann ein Objekt
  bauen, das als `GuardedRouter` durchgeht.
- Der einzige Weg dorthin ist `guardedRouter()`, und diese Funktion nimmt die
  Middlewares **nicht als Parameter**. Sie kann sie nicht weglassen, falsch
  sortieren oder überschreiben.
- `routers` ist `Record<string, GuardedRouter>`. Ein Router, der nicht durch
  `guardedRouter()` gegangen ist, passt nicht in die Konfiguration.

Die Reihenfolge ist Teil des Schutzes: erst die `X-Auth-*` der eingehenden
Anfrage löschen, dann prüfen und setzen. Umgekehrt überschreibt der Strip, was
die Auth gerade gesetzt hat (ADR 0004).

Dazu drei Schichten, die den Fehler bemerken, wenn ihn jemand mit einem Cast
oder von Hand an der Datei erzwingt: `gatewayConfigProblems()` auf der
erzeugten Struktur (läuft vor jedem Schreiben und blockiert), `verify` auf der
Datei, und der Startup-Check gegen die Traefik-API.

Zusätzlich liegt ein Catch-all-Router auf derselben Domain: ``Host(`<domain>`)``,
`priority: 1`, Dienst Deny-Backend, ohne `certResolver`. Jeder Pfad dieser
Domain ohne eigenen App-Router landet dort und bekommt 403. App-Router haben
keine Priorität gesetzt und bekommen von Traefik die Länge ihrer Regel, die
darüber liegt; Coolifys eigener Catch-all liegt bei `-1000` und verliert.

**Offen und nicht geprüft:** Ein **fremder** Host, der auf diese Instanz zeigt,
trifft keinen unserer Router. Was dann antwortet, ist Coolifys Catch-all, nicht
unser Deny-Backend. Unter ADR 0007 gibt es nur eine Domain, deshalb ist das
kein Teil dieses Nachweises.

### 1.3 Öffentliche Ausnahmen

Die Control Plane liegt hinter denselben zwei Middlewares wie jede App. Sonst
entsteht ein Kreis: Die Auth-Prüfung bräuchte eine Auth-Prüfung.

Die Ausnahmen stehen **im Code des Auth-Endpunkts**, nicht in der Traefik-
Konfiguration: Host der Control Plane plus Pfad-Allowlist (`/login`,
`/api/auth/*`, `/api/authz/forward`, `/healthz`, `/_next/static/*`). Alles
andere auf diesem Host braucht eine Session.

Der Pfad wird einmal dekodiert und dann geprüft; ein Pfad mit `.`, `..`, `\`,
einem Nullbyte oder einer unlesbaren Kodierung gilt als nicht öffentlich.
`/login/../grants` kommt damit nicht durch.

Begründung: Eine Konfigurationszeile kann ein Coolify-Update überschreiben,
eine Zeile im Code der Control Plane nicht. Verworfene Alternative: ein zweiter
Entrypoint ohne Middleware für die Control Plane — verworfen, weil Entrypoints
in der statischen Datei stehen, die Coolify gehört (ADR 0008).

**Der Preis dieser Lösung steht in Abschnitt 2, Zeile „Control Plane antwortet
langsam“:** Weil `/api/authz/forward` selbst hinter der Forward-Auth liegt,
gibt es keinen Weg, der Auth-Anfrage ein eigenes Timeout zu geben.

## 2. Fehlerfälle und das richtige Verhalten

Die Regel für jede Zeile: Im Zweifel geschlossen. Ein 500 ist besser als ein
ungeschütztes 200.

| Fall | Richtiges Verhalten | Wie es durchgesetzt wird |
| --- | --- | --- |
| Control Plane nicht erreichbar (Container aus, Deploy, Neustart) | Kein Durchlass. Traefik antwortet 5xx für alle App-Pfade | Traefiks Standard bei fehlgeschlagener Forward-Auth ist kein Durchlass. Es gibt keine Option, die das aufweicht, und es wird keine gesetzt. Gemessen: 500 für jeden Pfad |
| Control Plane antwortet langsam | **Kein Abbruch nach 2 s mehr.** Der Aufruf kommt durch, sobald die Control Plane antwortet — bis dahin hängt er, bis zu 30 s | Nichts setzt das durch, und das ist eine benannte Lücke, keine Vergesslichkeit: Traefiks `forwardAuth` hat keine Timeout-Option, ihr HTTP-Client hat 30 s fest eingebaut. Das 2-s-Timeout aus Fassung 1 hing an einem Dienst hinter einem eigenen Entrypoint; Entrypoints stehen statisch, und die statische Datei gehört Coolify (ADR 0008). Entschieden ist, das hinzunehmen, statt `/api/authz/forward` auf einen Router ohne Middlewares zu legen — das wäre ein Loch in genau der Schicht, die ADR 0008 zumauert. **Folge:** Die Lücke lässt nichts Unfreigegebenes durch; sie verlängert das Fenster, in dem eine hängende Control Plane das Gateway blockiert, von 2 s auf 30 s. Gemessen im Protokoll `2026-11-09-lokal-eigene-konfiguration.txt`, Fall 8, als Fehlschlag ausgewiesen; im Code als `GATEWAY_TIMEOUT_NOTE` |
| Control Plane antwortet 5xx oder ungültig | Kein Durchlass | Nur 2xx gilt als Freigabe. 3xx wird an den Client weitergegeben (Login), alles andere sperrt |
| Coolify-Update entfernt oder überschreibt App-Labels | Betrifft uns nicht mehr. Apps werden **ohne Domain** deployt, Coolify erzeugt dann keine einzige Traefik-Label (ADR 0008) | Der Schutz hängt nicht an Labels, sondern an unseren Routern in `openapps.yaml` |
| Coolify gibt einer App doch einen eigenen Router (`autogenerate_domain` ist per API default `true`) | Ein Router ohne unsere Middlewares wäre offen. Der Adapter sendet ausdrücklich `autogenerate_domain: false` | Der Lint nach dem Deploy sieht nach, ob das Deploy-Backend der App einen eigenen Weg nach innen gegeben hat, und meldet einen Befund (`degraded`) |
| Coolify überschreibt eine Datei im dynamischen Verzeichnis | Betrifft unsere Datei nicht: Coolify schreibt dort nur vier namentlich bekannte Dateien, `openapps.yaml` ist keine davon (ADR 0008). Die Liste steht als `RESERVED_DYNAMIC_FILENAMES` im Code, und ein reservierter Name verhindert den Start | Belegt gegen Coolify v4.7.1; bei einer späteren Fassung ist es wieder eine offene Frage |
| Unsere Datei fehlt oder ist nicht geladen | Kein Router mit unserem Präfix, also kein Pfad erreichbar. Laut, nicht still | Startup-Check: „kein einziger Router mit dem Präfix `openapps-`“ ⇒ Alarm, sichtbar in `/healthz`. Gemessen in Fassung 1 im Fall der halb wiederhergestellten Konfiguration: alle Router fielen aus, Antwort 404 |
| Ein Router verliert seine Middlewares (Datei von Hand geändert) | **Dieser Fall ist offen, und zwar sichtbar.** Der Aufruf kommt durch, mit gefälschten Headern — eine zweite Schicht gibt es nicht mehr | Der Generator kann es nicht erzeugen (1.2). Gemessen wurde es mit einer von Hand geänderten Datei: 200 und `X-Auth-User-Id: admin` in der App. Gesehen haben es Startup-Check (`alarm`) und der Konfigurations-Lint (`mismatch`), beide mit dem Router im Klartext |
| Registrierte App, noch nicht deployt | Ihr Pfad gibt **502**, nicht 403. Kein Loch — die Forward-Auth läuft davor —, aber sichtbar kaputt | Die Datei wird immer für alle registrierten Apps erzeugt; eine App ohne laufenden Container bekommt einen Router auf einen Dienst, der nicht antwortet. Bewusst in Kauf genommen, Alternative wäre eine Backend-Abfrage pro App. Steht in den Schulden der Roadmap |
| Middleware-Reihenfolge vertauscht | Aus dem Generator unmöglich: `guardedRouter()` setzt beide Namen als Literal-Tupel. In einer von Hand geänderten Datei dagegen möglich — dann greift keine zweite Schicht, sondern nur die Messung | Typ plus `gatewayConfigProblems()`, `verify` und Startup-Check, alle drei prüfen die Reihenfolge, nicht nur das Vorkommen |
| Ein Client schickt die `X-Auth-*` selbst | Sie erreichen die App nicht | Die Strip-Middleware löscht alle fünf Namen, bevor die Auth läuft. Gemessen: null gefälschte Werte in der App |
| `forwardedHeaders` am Entrypoint ist nicht leer | Dann bestimmt der Aufrufer `X-Forwarded-Host` und damit die Allowlist aus 1.3 | Der Entrypoint gehört Coolify; deshalb wird er **gemessen**, nicht gesetzt: Startup-Check ⇒ Alarm |
| App-Container direkt erreichbar (Port veröffentlicht, falsches Docker-Netz) | Deploy wird blockiert, soweit es die Arbeitskopie zeigt | Der Schritt `gateway-config` prüft Manifest und Arbeitskopie auf veröffentlichte Ports, ein zweites Netz und Env-Variablen, mit denen eine App Labels, Ports oder Netze selbst setzen will. Was auf dem Host wirklich läuft, prüft er nicht — siehe 3.3 |

Ausdrücklich nicht vorgesehen: ein Not-Schalter, der die Auth überspringt, und
ein „fail open“-Modus für Wartungsfenster.

Bei Alarm stirbt die Control Plane **nicht** und `/healthz` wird nicht rot. Eine
neu startende oder tote Control Plane sperrt jeden Pfad, auch den Login und die
Oberfläche, über die die Konfiguration wieder ausgerollt wird. Der Alarm steht
im Log und in `/healthz`, gehandelt wird von Hand.

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
| `X-Auth-Signature` | HMAC-SHA256 über App-Id, Host und die vier Werte oben |

Alle fünf Header werden **immer** gesetzt, auch bei leeren Werten. Sonst
reicht Traefik einen vom Client mitgeschickten Header unverändert durch.
Übernommen werden genau diese fünf: ein Header mehr in
`authResponseHeaders` ist ein Befund des Lints, ein Header weniger auch.

### 3.2 Was die App prüft

Die App liest die Header nur über `@openapps/sdk` (Regel 1 aus `AGENTS.md`).
Das SDK verwirft den Aufruf, wenn eine der Bedingungen verletzt ist:

1. `X-Auth-Signature` passt zum HMAC über die übrigen Werte, berechnet mit dem
   App-eigenen Secret aus der Env (`OPENAPPS_AUTH_SECRET`).
2. `X-Auth-Issued-At` liegt höchstens 60 s zurück und nicht in der Zukunft.
3. Der Host im Signatur-Material ist der **konfigurierte** Host der App
   (`OPENAPPS_APP_HOST`), nicht der aus der Anfrage. Unter ADR 0007 ist das für
   alle Apps dieselbe Domain; der Host trägt zur Trennung nichts mehr bei.
   Getrennt wird über die App-Id zusammen mit dem je App abgeleiteten Secret —
   eine Signatur für App A passt in App B nicht. Weicht der Host der Anfrage
   vom konfigurierten ab, lehnt das SDK mit klarer Meldung ab, bevor die
   Signatur scheitert.

Ein Angreifer, der die Header selbst setzt, kann die Signatur nicht erzeugen.
Er kennt das Secret nicht: Es wird pro App von der Control Plane abgeleitet und
nur als Env-Variable in diese App gegeben. Eine abgefangene gültige Signatur
ist nach 60 s wertlos und gilt nur für diese App.

**Was damit nicht mehr abgedeckt ist, weil die Domain geteilt wird:** Ein
Cookie gilt für alle Apps dieser Domain. Die Browsertrennung fällt mit ADR 0007
weg; das ist der dort bewusst gezahlte Preis und kein Befund dieser Spec.

### 3.3 Welche Annahme das an die Infrastruktur stellt

Das Modell hält nur, solange der App-Container ausschließlich über das Gateway
erreichbar ist. Konkret:

- Kein veröffentlichter Host-Port am App-Container.
- App und Traefik im gemeinsamen Docker-Netz, die App in keinem weiteren.
- Das App-Secret liegt nur in Gateway und App, nicht in Logs, nicht im Repo.

Der Schritt `gateway-config` prüft diese Punkte vor dem Deploy an Manifest und
Arbeitskopie, der Lint nach dem Deploy sieht zusätzlich beim Deploy-Backend
nach. **Was fehlt, und es fehlt ganz:** eine Messung am laufenden Container
selbst (`docker inspect`). Bis die steht, sind „kein veröffentlichter Port“ und
„kein zweites Netz“ pro Deploy ein Hinweis, keine Sperre. Die Annahme steht
hier offen, weil sie nicht durch die App abgesichert werden kann, sondern nur
durch die Plattform.

Hinzu kommt der Weg, auf dem die Konfiguration auf den Host kommt: Die Control
Plane schreibt in ein gemountetes Verzeichnis. Das setzt voraus, dass sie auf
demselben Server läuft wie der Proxy und dass der Mount in ihrer
Dienstdefinition steht. Fehlt er, scheitert der erste Deploy mit einem Fehler,
der das Verzeichnis nennt — nicht still. Mehrere Server sind damit nicht
abgedeckt (ADR 0008).

## 4. Nachweis für DoD 2

Zwei Werkzeuge, und das eine ersetzt das andere nicht:

- `infra/traefik/local/nachweis.sh` prüft die **Kette** gegen einen lokalen
  Stapel: erzeugte `openapps.yaml`, Deny-Backend, Dummy-Apps, Stub der
  Forward-Auth. Neun Fälle, Exit-Code 1 bei jedem Fehlschlag.
- `infra/scripts/check-auth.sh` prüft eine **Liste echter Adressen** auf einer
  Zielinstanz, vor und nach einem Coolify-Update.

### 4.1 Was `check-auth.sh` tut

Aufruf: `check-auth.sh <adressliste>`, Muster in `infra/app-urls.txt.example`.

1. Adressen aus der Liste: die Wurzel der gemeinsamen Domain, ein Pfad ohne
   App, je App ihr Pfad **und** ein tieferer Pfad darunter, dazu die Control
   Plane. Der tiefere Pfad fällt nur auf, wenn er in der Liste steht.
2. Jede Adresse ohne Cookie abrufen, ohne Redirects zu folgen. Erwartet wird
   401, 403 oder eine Weiterleitung auf den Login. Alles andere — auch 200,
   auch 502 — ist ein Fehlschlag: Ein Dienst, der nicht antwortet, ist kein
   Beweis dafür, dass er geschützt ist.
3. Zweiter Teil: Prüfungen gegen die Traefik-API, als Shell, damit der Nachweis
   nach einem Coolify-Update auch ohne laufende Control Plane geführt werden
   kann. Adresse über `TRAEFIK_API_URL`; ohne erreichbare API wird dieser Teil
   **sichtbar** übersprungen.
4. Ausgabe als Zeile pro Adresse, Exit-Code 1 bei jedem Verstoß, Protokoll nach
   `docs/nachweise/dod-02-laeufe/`.

**Offen:** Der zweite Teil des Skripts prüft noch die Middleware-Kette am
Entrypoint `websecure` aus Fassung 1. Diesen Entrypoint gibt es in Coolifys
Konfiguration nicht (sie heißt `https`), und die Kette hängt nicht mehr dort.
Die Prüfung muss auf das umgestellt werden, was der Startup-Check heute macht:
jeder Router mit dem Präfix `openapps-` trägt `[strip, forward-auth]` in dieser
Reihenfolge und ist `enabled`, der Catch-all ist da, `forwardedHeaders` am
Entrypoint ist leer. Bis dahin ist der zweite Teil kein Nachweis.

Was `check-auth.sh` nicht kann: Header-Fälschung und „Control Plane aus“ prüft
heute nur `local/nachweis.sh` gegen den lokalen Stapel.

### 4.2 Erwartung pro Adresse

| Adresse | Ohne Session erwartet |
| --- | --- |
| Registrierter App-Pfad, Einstieg und ein tieferer Pfad | 302 auf den Login oder 401/403. Kein 200, kein App-Inhalt im Body |
| Wurzel der gemeinsamen Domain | Ein Nein — 403 vom Deny-Backend oder die Entscheidung der Forward-Auth. Kein 404 einer App, kein 200 |
| Pfad ohne App auf derselben Domain | 403 |
| Control Plane, `/login` und `/api/auth/*` | 200 |
| Control Plane, alles andere | 302 oder 401/403 |
| App-Pfad mit selbst gesetzten Auth-Headern | Keine gefälschten Werte in der App; das Gateway löscht sie vor der Prüfung |
| Alle App-Pfade, Control Plane angehalten | 5xx, nie 200 |

Zusätzlich geprüft: Der Body eines 403 enthält keinen App-Inhalt, und die
Antwort trägt keinen `Set-Cookie` der App.

### 4.3 Wie das Coolify-Update im Test ausgelöst wird

Das Update wird echt ausgeführt, nicht simuliert. Ablauf:

1. `check-auth.sh` mit der Adressliste, Ergebnis ablegen.
2. Coolify-Version notieren und den Inhalt von
   `/data/coolify/proxy/dynamic/` sichern, `openapps.yaml` eingeschlossen.
3. Coolify über seinen eigenen Weg aktualisieren: Update im Coolify-UI oder
   `curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash` auf dem
   Host, je nachdem, was die installierte Version vorsieht.
4. Warten, bis Coolify und Traefik wieder laufen. Keine eigene Reparatur
   vorher — der Lauf soll zeigen, was das Update von sich aus tut.
5. `check-auth.sh` erneut, dazu der Startup-Check der Control Plane.
6. Beide Ergebnisse, die Coolify-Versionen und der Diff von
   `/data/coolify/proxy/dynamic/` ins Protokoll.

Dazu ein zweiter, härterer Lauf: eine frische App über `create_app` anlegen und
ihren Pfad aufrufen, **bevor** sie deployt ist. Erwartung nach heutigem Stand
502 und kein App-Inhalt — nicht 403. Siehe Abschnitt 2.

### 4.4 Signal für „nicht stabil“

Als nicht stabil gilt der Ansatz, wenn eines davon zutrifft:

- Ein App-Pfad antwortet in einem der Läufe ohne Session mit 200.
- Nach dem Update fehlt `openapps.yaml`, oder ein Router mit dem Präfix
  `openapps-` läuft ohne die zwei Middlewares bzw. in falscher Reihenfolge.
- Coolify hat die Datei verändert oder entfernt.
- Die Wiederherstellung nach dem Update braucht einen manuellen Eingriff, der
  nicht als Skript oder als Aufruf der Control Plane beschrieben ist.
- Der Zustand „ungeschützt erreichbar“ tritt überhaupt auf, auch nur für
  Sekunden während des Updates.

Der letzte Punkt braucht eine Messung, keine Beobachtung: Während des Updates
läuft eine Schleife im Sekundentakt gegen einen App-Pfad und schreibt jeden
Statuscode mit. **Diese Messung gibt es noch nicht als Skript.**

## 5. Abbruch-Kriterium

### 5.1 Was am Ende von Woche 1 stehen muss

Alles davon, sonst gilt das Abbruch-Kriterium aus `docs/02-roadmap.md`. Der
Stand steht dahinter, damit niemand ihn im Kopf führen muss:

1. `infra/scripts/check-auth.sh` existiert und läuft ohne Handgriffe —
   **steht**, der zweite Teil ist nachzuziehen (4.1).
2. Zwei grüne Läufe, vor und nach einem echten Coolify-Update, mit mindestens
   drei App-Pfaden plus einem Pfad ohne App — **offen**, es gibt keinen Lauf
   gegen eine Zielinstanz.
3. Null 200-Antworten ohne Session in beiden Läufen und in der Schleife
   während des Updates — **offen**, die Schleifen-Messung fehlt.
4. Der Fehlerfall „Control Plane aus“ ist gemessen und sperrt — **lokal
   gemessen** (500 für jeden Pfad), gegen den Stub.
5. Der Header-Fälschungs-Test ist gemessen und sperrt — **lokal gemessen**,
   null gefälschte Werte in der App.
6. Eine App ohne Router in unserer Datei ist gemessen und gibt 403 —
   **lokal gemessen**, `x-openapps-deny: catch-all`.

### 5.2 Was „Ansatz neu denken“ konkret heißt

Es stehen zwei Alternativen zur Wahl. Entschieden wird als ADR, nicht hier.

**A: Eigener Reverse-Proxy vor Coolify.** Ein von uns verwalteter Traefik oder
Caddy nimmt Port 80/443, terminiert TLS, prüft die Auth und leitet an Coolifys
Traefik weiter.

- Kostet: zweite Proxy-Schicht, eigene Zertifikatsverwaltung, eigenes
  DNS- und Domain-Handling. Coolifys Domain-Funktion wird teilweise
  umgangen, die Adapter-Schicht muss das abbilden.
- Kostet an Prinzipien: nichts. Regel 1 bleibt, Apps bleiben ohne Login-Code.
- Gewinnt: Coolify-Updates können die Auth nicht mehr anfassen. Dort wäre auch
  das 2-s-Timeout aus Abschnitt 2 wieder möglich, weil die Entrypoints dann uns
  gehören.
- Nach ADR 0008 ist das der Rückfallweg, nicht mehr der nächste Schritt: dass
  Coolify eine eigene dynamische Konfiguration zulässt, ist für v4.7.1 belegt.

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
- Die Trennung der Apps im Browser. Sie fällt mit ADR 0007 weg und gehört in
  die Entscheidung über den Katalog.
