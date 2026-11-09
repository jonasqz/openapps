# Infrastruktur

Was hier liegt, betreibt die Plattform — es ist kein Teil des Produkts.

| Pfad | Was |
| --- | --- |
| `scripts/check-auth.sh` | Nachweis für DoD 2: kein App-Pfad ohne Session erreichbar, vor und nach jedem Coolify-Update |
| `app-urls.txt.example` | Vorlage für die Adressliste, die das Skript prüft (eine Domain, ein Pfad je App — ADR 0007) |
| `traefik/traefik.yml` | Statische Traefik-Konfiguration: Middleware am Entrypoint, Provider, API, Timeouts, TLS |
| `traefik/dynamic/` | Middlewares, Catch-all-Router und der Weg zur Control Plane — alles, was kein Container ueberschreiben darf |
| `traefik/deny-backend/` | nginx, das auf jede Anfrage 403 antwortet |
| `traefik/docker-compose.yml` | Lokaler Stapel fuer den Nachweis: Traefik, Deny-Backend, Auth-Stub, drei Dummy-Apps |
| `traefik/local/` | Nur fuer den lokalen Lauf: Stub, Dummy-App, Wegwerf-Zertifikat, `nachweis.sh` |

## Die größte Annahme

Die Auth läuft über Traefik-Labels, die Coolify verwaltet. Ein Coolify-Update
kann sie ändern oder entfernen — dann sind Apps ungeschützt erreichbar. Deshalb:

```bash
infra/scripts/check-auth.sh infra/app-urls.txt   # vor dem Update
# Coolify aktualisieren
infra/scripts/check-auth.sh infra/app-urls.txt   # danach, gleiche Liste
```

Ein Lauf ohne Fehlschlag ist der Nachweis. Ein Dienst, der nicht antwortet,
zählt als Fehlschlag — nicht als geschützt.

## Das Gateway: wo der Schutz haengt

Drei Stellen, und nur diese drei:

1. `traefik/traefik.yml`, `entryPoints.websecure.http.middlewares`: die zwei
   Middlewares haengen am **Entrypoint**, nicht an den Labels einer App. Damit
   gelten sie fuer jeden Router auf diesem Entrypoint, auch fuer die, die
   Coolify selbst anlegt (Spec 1.2).
2. `traefik/dynamic/middlewares.yml`: erst alle `X-Auth-*` der eingehenden
   Anfrage loeschen, dann die Forward-Auth. Ohne den ersten Schritt ist das
   Modell aus ADR 0004 wertlos.
3. `traefik/dynamic/catch-all.yml`: `priority: 1`, passt auf jeden Host, zeigt
   auf das Deny-Backend. Jede Domain ohne eigenen Router bekommt 403.

Dazu `traefik/dynamic/control-plane.yml`: Sie ist der Grund, warum die
Forward-Auth nicht direkt auf die Control Plane zeigt. Traefiks
`forwardAuth`-Middleware hat keine Timeout-Option — gemessen im Nachweis, eine
Control Plane mit 3,5 s Antwortzeit kam mit 200 durch. Der Umweg ueber den
internen `authz`-Entrypoint macht aus der Auth-Anfrage einen normalen
Traefik-Dienst, und der hat ein 2-s-Timeout. Wer den Umweg entfernt, nimmt
Spec Abschnitt 2 Zeile 2 heraus.

## Lokalen Nachweis fahren

```bash
cd infra/traefik
./local/make-certs.sh            # Wegwerf-Zertifikat fuer *.local.test
docker compose up -d
./local/nachweis.sh              # acht Faelle, Exit-Code 1 bei jedem Fehlschlag
./local/nachweis.sh > ../../docs/nachweise/dod-02-laeufe/$(date +%F)-lokal.txt
docker compose down
```

Der Stapel braucht keine Control Plane: `local/control-plane-stub.py` antwortet
je nach Pfad 200, 302, 403 oder absichtlich zu langsam. Die Dummy-Apps geben
zurueck, welche `X-Auth-*`-Header bei ihnen angekommen sind — daran haengt der
Beweis fuer Fall 1 und Fall 4.

Geprueft wird dabei die echte Konfiguration: `traefik.yml`, `dynamic/` und
`deny-backend/` werden unveraendert gemountet. Lokal kommen nur ein selbst
signiertes Standard-Zertifikat und ein Router-Label ohne `tls.certresolver`
hinzu, weil Let's Encrypt fuer `.local.test` nichts ausstellt.

`local/nachweis.sh` prueft die Kette, `scripts/check-auth.sh` prueft eine Liste
echter Adressen. Das eine ersetzt das andere nicht.

Die Dateien unter `traefik/` stammen aus dem Subdomain-Aufbau und sind mit
ADR 0007 **offen**: Wo die Router fuer die App-Pfade stehen — aus Docker-Labels
oder aus einer eigenen dynamischen Konfiguration — haengt daran, ob Coolify ein
solches Verzeichnis anbietet, das ein Update ueberlebt. Bis das belegt ist,
bleibt hier alles, wie es ist.

## Nach einem Coolify-Update

```bash
infra/scripts/check-auth.sh infra/app-urls.txt    # erst messen, nicht reparieren
```

Schlaegt der Lauf an oder antwortet ein App-Pfad mit 200, dann in dieser
Reihenfolge:

1. `curl http://<traefik>:8080/api/entrypoints` und nachsehen, ob der Eintrag
   `websecure` noch
   `http.middlewares: ["openapps-strip-auth-headers@file","openapps-forward-auth@file"]`
   hat. Fehlt einer der Namen, hat das Update die statische Konfiguration
   angefasst. Denselben Endpunkt fragt der Startup-Check der Control Plane ab.
2. `traefik.yml` und `dynamic/` aus diesem Verzeichnis in die Traefik-Instanz
   kopieren (`/etc/traefik/traefik.yml`, `/etc/traefik/dynamic/`), die
   ACME-Adresse in `traefik.yml` ist ein Platzhalter und muss pro Host gesetzt
   sein. Traefik neu starten.
3. `check-auth.sh` erneut. Erst ein Lauf ohne Fehlschlag ist die Freigabe.

Fehlt nur das dynamische Verzeichnis, ist das gemessen **kein** Loch: ohne die
Middleware-Definition fallen alle Router auf dem Entrypoint aus und antworten
404. Laut im Log, geschlossen nach aussen.

Das Update selbst ist kein Grund, eine Reparatur vorzuziehen: Der Lauf soll
zeigen, was das Update von sich aus tut (Spec 4.3).

## Was auf dem Host noch gebraucht wird

- Ein Docker-Netz `openapps-gateway`; Traefik sucht Container nur dort
  (`providers.docker.network`).
- Ein beschreibbares Volume auf `/letsencrypt` fuer `acme.json`. Fehlt es,
  laesst Traefik den ACME-Resolver fallen und liefert nur das
  Standard-Zertifikat — TLS-Warnung, aber kein offener Zugang.
- Der Entrypoint `traefik` (Port 8080, API) darf nicht ins Internet. Im
  Compose ist er auf `127.0.0.1` veroeffentlicht; liegt die Control Plane im
  Gateway-Netz, kann das Mapping ganz entfallen.
