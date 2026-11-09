# Nachweis DoD 2: Jede App hinter dem gemeinsamen Login

**Kriterium:** Jede App liegt hinter dem gemeinsamen Login. Ohne Login kommt man
nicht rein, auch nach einem Coolify-Update.

Geprüft wird über **Pfade**, nicht über Domains: Jede App liegt unter
`https://<eine-domain>/<app>` (ADR 0007). Der Sinn ist derselbe wie vorher, die
Adressen sind andere — das Skript ruft dieselben Apps unter ihren Pfaden auf.

**Art:** Testskript plus Protokoll. Spec:
[`../specs/woche-1-forward-auth.md`](../specs/woche-1-forward-auth.md).

## Der Nachweis ist

`infra/scripts/check-auth.sh` mit einer Adressliste nach dem Muster von
`infra/app-urls.txt.example`, zweimal ausgeführt: vor und nach einem echten
Coolify-Update. Dazu die Schleifen-Messung während des Updates (Spec 4.4) und
der Startup-Check der Control Plane.

Daneben steht `infra/traefik/local/nachweis.sh`: Er prüft die Kette gegen einen
lokalen Stapel und deckt die Fälle ab, die `check-auth.sh` nicht kann
(Header-Fälschung, Control Plane aus, App ohne Router).

**Stand:** Zwei lokale Läufe liegen vor, siehe unten. Kein Lauf gegen eine
Zielinstanz, kein Lauf um ein echtes Coolify-Update, keine Schleifen-Messung.
Damit ist DoD 2 **offen**.

## Die zwei Läufe und was jeder zeigt

### 1. [`dod-02-laeufe/2026-11-09-lokal-gateway.txt`](dod-02-laeufe/2026-11-09-lokal-gateway.txt) — der **alte** Aufbau

Subdomain je App, Forward-Auth als Middleware am Traefik-**Entrypoint**, Router
aus Docker-Labels, eigene statische Konfiguration. Acht Fälle, alle OK, gegen
Traefik 3.3.7.

**Was er zeigt:** dass der Entrypoint-Aufbau trug — einschließlich eines
2-s-Abbruchs bei langsamer Control Plane (Fall 8), der über einen internen
Entrypoint erreicht wurde.

**Was er nicht mehr zeigt:** den heutigen Aufbau. Mit ADR 0007 und 0008 sind
Subdomains, Entrypoint-Middleware, Docker-Labels und die eigene statische
Datei weg. Der Lauf bleibt als Beleg für die Vorgeschichte im Repo, vor allem
für die Herkunft des Timeout-Problems; als Nachweis für den Code von heute
zählt er nicht.

### 2. [`dod-02-laeufe/2026-11-09-lokal-eigene-konfiguration.txt`](dod-02-laeufe/2026-11-09-lokal-eigene-konfiguration.txt) — der **heutige** Aufbau

Eine Domain, ein Pfad je App, Router aus der von der Control Plane **erzeugten**
`openapps.yaml`, Traefik mit Coolifys statischer Form (Kommandozeilen-Argumente
nachgebildet), kein Docker-Provider, kein Docker-Socket. Neun Fälle, **ein
Fehlschlag**.

**Was er zeigt:**

- Kein App-Pfad kommt ohne Entscheidung der Forward-Auth durch; ein 403 der
  Auth erreicht die App nicht.
- Ohne Session 302 auf den Login, mit dem Pfad als Rückweg.
- Selbst gesetzte `X-Auth-*` erreichen die App nicht (null gefälschte Werte).
- Ein Pfad ohne App und eine laufende App ohne Router bekommen 403 vom
  Deny-Backend — auch dann, wenn die Auth absichtlich 200 sagt.
- Control Plane gestoppt: 500 für jeden Pfad, kein Durchlass.
- Die geprüfte Konfiguration ist die **erzeugte**: `local/konfiguration-
  erzeugen.sh` ruft `buildGatewayConfig()` und `renderGatewayConfig()`.
- Nimmt man einem Router von Hand die Middlewares, kommt der Aufruf mit
  gefälschten Headern durch (200) — und Startup-Check (`alarm`) und
  Konfigurations-Lint (`mismatch`) benennen ihn beide. Das ist der Beleg, dass
  es keine zweite Schicht mehr gibt und dass die Messung sie nicht ersetzt.

**Was er nicht zeigt, und das ist der wichtigere Teil:**

- **Die Forward-Auth war ein Stub**, nicht die echte Route. Der Stub steuert
  nur den Antwortcode. Die Prüfkette aus Spec 1.1 (Session, App aus dem ersten
  Pfadsegment, Freigabe, Pfad-Allowlist) und die echte HMAC-Signatur sind
  **nicht** Teil dieses Laufs; die Signatur ist ein Platzhalter-String.
- **Fall 8 ist gefallen:** Ein Stub mit 3,5 s Antwortzeit kommt mit 200 durch.
  Das 2-s-Timeout ist mit dem internen Entrypoint weggefallen, Traefiks
  `forwardAuth` hat keine Timeout-Option, ihr Client hat 30 s fest eingebaut.
  Hingenommen, nicht behoben (Spec 2, Zeile „Control Plane antwortet langsam“).
- Nichts über Coolify: keine Instanz, kein Update, kein Deploy über die API.
- Nichts über Better Auth und Postgres.
- Nichts über die Lücke während eines Updates; die Schleifen-Messung aus
  Spec 4.4 fehlt.

## Was DoD 2 auch mit grünen Läufen nicht beweist

- **Nicht**, dass es für die nächste Coolify-Version gilt. Ein Lauf gilt für
  genau die Versionen im Protokoll. Deshalb läuft er nach jedem Update neu.
- **Nicht**, dass die App-Container unerreichbar sind. Das Skript spricht über
  das Gateway. Ein veröffentlichter Port oder ein zweites Docker-Netz bleibt
  unsichtbar. Dafür ist der Review-Gate-Schritt `gateway-config` zuständig
  (Spec 3.3) — und der liest Manifest und Arbeitskopie, nicht den laufenden
  Container.
- **Nicht**, dass die Apps im Browser getrennt sind. Unter einer Domain gilt
  ein Cookie für alle Apps; das ist der bewusst gezahlte Preis aus ADR 0007 und
  kein Befund dieses Nachweises.
- **Nicht**, dass die Freigaben stimmen. Der Test prüft „ohne Session kein
  Zugang“, nicht „mit Session nur die erlaubten Apps“. Das gehört zu DoD 3.
- **Nicht**, dass das App-Secret nicht geleakt ist. Die Signatur-Prüfung hält
  nur, solange das Secret geheim bleibt.

## Protokoll der Läufe

| Datum | Aufbau | Coolify vorher | Coolify nachher | Adressen | Lücke während Update | Ergebnis |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-11-09 | alt: Subdomains, Entrypoint-Middleware | – (lokal, kein Coolify) | – | 2 App-Subdomains, 1 unbekannte, Control Plane | nicht gemessen | 8 von 8 OK |
| 2026-11-09 | heute: eine Domain, eigene dynamische Konfiguration | – (lokal, kein Coolify) | – | 2 App-Pfade, 1 Pfad ohne App, 1 App ohne Router, Control Plane | nicht gemessen | 8 von 9 OK, Fall 8 (Timeout) gefallen |
