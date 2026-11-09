# Infrastruktur

Was hier liegt, betreibt die Plattform — es ist kein Teil des Produkts.

Stand nach [ADR 0007](../docs/decisions/0007-eine-domain-pfade-statt-subdomains.md)
(eine Domain, ein Pfad je App) und
[ADR 0008](../docs/decisions/0008-eigene-dynamische-konfiguration.md) (die
Control Plane schreibt ihre Traefik-Router selbst). Eine eigene **statische**
Traefik-Konfiguration gibt es nicht mehr; sie gehoert Coolify, und wir fassen
sie nicht an.

| Pfad | Was |
| --- | --- |
| `scripts/check-auth.sh` | Nachweis fuer DoD 2: kein App-Pfad ohne Session erreichbar, vor und nach jedem Coolify-Update |
| `app-urls.txt.example` | Vorlage fuer die Adressliste, die das Skript prueft (eine Domain, ein Pfad je App — ADR 0007) |
| `traefik/dynamic/openapps.example.yaml` | **Beispiel**, nicht zum Ausrollen: was der Generator ausgibt. Auf dem Host schreibt die Control Plane diese Datei selbst |
| `traefik/deny-backend/` | nginx, das auf jede Anfrage 403 antwortet. Das Einzige hier, was auf einen Host gehoert |
| `traefik/docker-compose.yml` | Lokaler Stapel fuer den Nachweis: Traefik in Coolifys statischer Form, Deny-Backend, Auth-Stub, drei Dummy-Apps |
| `traefik/local/` | Nur fuer den lokalen Lauf: Generator-Aufruf, Stub, Dummy-App, Wegwerf-Zertifikat, `nachweis.sh` |
| `traefik/.env.example` | Nur Ports fuer den lokalen Stapel. Keine Secrets |

## Die groesste Annahme

Der Schutz vor den Apps haengt an einer Datei im dynamischen Verzeichnis von
Coolifys Proxy. Dass Coolify sie ueber ein Update nicht anfasst, ist fuer
**v4.7.1** belegt (ADR 0008) und fuer jede spaetere Fassung wieder offen.
Deshalb:

```bash
infra/scripts/check-auth.sh infra/app-urls.txt   # vor dem Update
# Coolify aktualisieren
infra/scripts/check-auth.sh infra/app-urls.txt   # danach, gleiche Liste
```

Ein Lauf ohne Fehlschlag ist der Nachweis. Ein Dienst, der nicht antwortet,
zaehlt als Fehlschlag — nicht als geschuetzt.

## Das Gateway: wo der Schutz haengt

**Eine Stelle, plus der Pfad, auf dem sie landet.**

1. `apps/control-plane/src/domain/gateway-config.ts` — der Generator. Jeder
   Router, den er ausgibt, traegt die zwei Middlewares
   (`openapps-strip-auth-headers`, dann `openapps-forward-auth`), und das
   haengt am **Typ**: `GuardedRouter` ist ausserhalb der Datei nicht
   konstruierbar, und die einzige Fabrik nimmt die Middlewares nicht als
   Parameter. Ein Router ohne Forward-Auth kann hier nicht entstehen.
   Die Reihenfolge ist Teil der Sicherheit: erst alle `X-Auth-*` der
   eingehenden Anfrage loeschen, dann pruefen und setzen. Vertauscht ist das
   Modell aus ADR 0004 wertlos.
2. Der gemountete Pfad: `/data/coolify/proxy/dynamic/openapps.yaml` auf dem
   Host, im Container der Control Plane `/traefik/dynamic`
   (`GATEWAY_DYNAMIC_DIR`). Geschrieben wird atomar — Temporaerdatei im selben
   Verzeichnis, dann `rename` —, damit Traefiks File-Provider mit `watch` nie
   eine halbe Datei sieht. `openapps.yaml` ist keiner der vier Dateinamen, die
   Coolify dort selbst schreibt; die Liste steht als
   `RESERVED_DYNAMIC_FILENAMES` im Code und verhindert den Start, wenn jemand
   einen davon konfiguriert.

Drei Messungen stehen daneben. Sie **setzen** nichts, sie sagen, was ist:

- `verify` nach jedem Deploy vergleicht die Datei auf dem Host Zeichen fuer
  Zeichen mit dem, was der Generator jetzt schreiben wuerde (`mismatch` nennt
  die abweichende Zeile).
- Der Startup-Check (`apps/control-plane/src/infra/gateway-guard.ts`) fragt die
  Traefik-API: gibt es unsere zwei Middlewares, traegt **jeder** Router mit dem
  Praefix `openapps-` die Kette in dieser Reihenfolge, ist er `enabled`, ist
  der Catch-all da, und ist `forwardedHeaders` am Entrypoint leer. Befund =
  Alarm, sichtbar in `/healthz`.
- Der Review-Gate-Schritt `gateway-config` prueft vor dem Deploy, dass sich
  fuer diese App ueberhaupt eine tragende Konfiguration erzeugen laesst.

Was es dafuer **nicht** mehr gibt: keine Entrypoint-Middleware, kein
`traefik.yml` von uns, keine Traefik-Labels an den Apps. Apps werden ohne
Domain deployt; Coolify erzeugt dann keine einzige Traefik-Label, und
erreichbar wird eine App allein ueber ihren Router in `openapps.yaml`.

### Das verlorene 2-s-Timeout

Traefiks `forwardAuth` hat keine Timeout-Option; ihr HTTP-Client hat 30 s fest
eingebaut. Die alte Fassung kam an ein 2-s-Timeout, indem die Auth-Anfrage
ueber einen internen Entrypoint lief — und Entrypoints stehen in der statischen
Konfiguration, die jetzt Coolify gehoert. Gemessen: Eine Control Plane mit
3,5 s Antwortzeit kommt mit **200** durch.

Das ist hingenommen, nicht behoben. Die Alternative waere,
`/api/authz/forward` auf einen Router ohne Middlewares zu legen — ein Loch in
genau der Schicht, die ADR 0008 zumauert. Folge: Die Luecke laesst nichts
Unfreigegebenes durch, verlaengert aber das Fenster, in dem eine haengende
Control Plane das Gateway blockiert, von 2 s auf 30 s. Im Code steht sie als
`GATEWAY_TIMEOUT_NOTE`, im Protokoll als Fall 8.

## Lokalen Nachweis fahren

```bash
cd infra/traefik
./local/make-certs.sh                 # Wegwerf-Zertifikat fuer *.local.test
./local/konfiguration-erzeugen.sh     # openapps.yaml mit dem echten Generator
docker compose up -d
./local/nachweis.sh                   # neun Faelle, Exit-Code 1 bei Fehlschlag
docker compose down
```

Der Stapel braucht keine Control Plane: `local/control-plane-stub.py` antwortet
je nach Pfad 200, 302, 403 oder absichtlich zu langsam. Die Dummy-Apps geben
zurueck, welche `X-Auth-*`-Header bei ihnen angekommen sind — daran haengt der
Beweis fuer die Faelle 1 und 4.

Geprueft wird die **erzeugte** Konfiguration, nicht eine Nachbildung:
`local/konfiguration-erzeugen.sh` ruft `buildGatewayConfig()` und
`renderGatewayConfig()` aus der Control Plane. Traefik laeuft mit
Kommandozeilen-Argumenten, die Coolifys Defaults nachbilden (Entrypoints `http`
und `https`, File-Provider mit `watch`, kein Docker-Provider, kein
Docker-Socket). Lokal kommt nur ein selbst signiertes Standard-Zertifikat
hinzu, weil Let's Encrypt fuer `.local.test` nichts ausstellt.

`local/nachweis.sh` prueft die Kette, `scripts/check-auth.sh` prueft eine Liste
echter Adressen. Das eine ersetzt das andere nicht.

Der Lauf, der dabei herauskommt, liegt als
`docs/nachweise/dod-02-laeufe/2026-11-09-lokal-eigene-konfiguration.txt`.
Fall 8 ist darin ein **Fehlschlag** — das verlorene Timeout, siehe oben.

## Nach einem Coolify-Update

```bash
infra/scripts/check-auth.sh infra/app-urls.txt    # erst messen, nicht reparieren
```

Schlaegt der Lauf an oder antwortet ein App-Pfad mit 200, dann in dieser
Reihenfolge:

1. Nachsehen, ob die Datei noch da ist:
   `ls -l /data/coolify/proxy/dynamic/openapps.yaml`.
2. `curl http://<traefik>:8080/api/http/routers` und pruefen, ob jeder Router
   mit dem Praefix `openapps-` noch
   `["openapps-strip-auth-headers@file","openapps-forward-auth@file"]` traegt,
   in dieser Reihenfolge, und `status: enabled` hat. Denselben Endpunkt fragt
   der Startup-Check der Control Plane ab; sein Ergebnis steht in `/healthz`.
3. Fehlt oder weicht etwas ab: die Control Plane einen Deploy ausloesen lassen
   (jeder Deploy schreibt die Datei vollstaendig neu) oder sie neu starten. Von
   Hand editieren ist der Weg, der den Lint ausloest, nicht der, der ihn
   beruhigt.
4. `check-auth.sh` erneut. Erst ein Lauf ohne Fehlschlag ist die Freigabe.

Fehlt die Datei ganz, ist das gemessen **kein** Loch: Ohne sie existiert kein
Router mit unserem Praefix, kein App-Pfad ist erreichbar, und der Startup-Check
meldet „kein einziger Router mit dem Praefix `openapps-`“. Laut im Log,
geschlossen nach aussen.

Das Update selbst ist kein Grund, eine Reparatur vorzuziehen: Der Lauf soll
zeigen, was das Update von sich aus tut (Spec 4.3).

**Offen:** Der zweite Teil von `check-auth.sh` prueft noch die
Middleware-Kette am Entrypoint `websecure` aus dem alten Aufbau. Den
Entrypoint gibt es in Coolifys Konfiguration nicht (sie heisst `https`), und
die Kette haengt nicht mehr dort. Bis das umgestellt ist, ist dieser Teil des
Skripts kein Nachweis — die Router-Pruefung oben ersetzt ihn von Hand.

## Was auf dem Host noch gebraucht wird

- Die Control Plane laeuft auf **demselben** Server wie Coolifys Proxy, und
  `/data/coolify/proxy/dynamic` ist in ihre Dienstdefinition gemountet (im
  Container `/traefik/dynamic`). Fehlt der Mount, scheitert der erste Deploy
  mit einem Fehler, der das Verzeichnis nennt — nicht still. Mehrere Server
  deckt dieser Weg nicht ab (ADR 0008).
- Das Deny-Backend aus `traefik/deny-backend/` laeuft im Netz des Proxys unter
  dem Alias, den `GATEWAY_DENY_BACKEND_URL` nennt (Default
  `http://openapps-deny-backend:8080`). Ohne es landet ein unbekannter Pfad in
  Traefiks 404 statt in einem klaren Nein.
- Ein Docker-Netz, in dem Proxy, Control Plane und Apps zusammen liegen
  (`GATEWAY_DOCKER_NETWORK`, Default `coolify`). Die Dienste zeigen auf
  **Netz-Aliase**, nicht auf Containernamen: Letztere tragen ein
  Zeitstempel-Suffix und aendern sich bei jedem Deploy.
- Env der Control Plane, die in die Konfiguration eingeht: `APPS_DOMAIN`,
  `CONTROL_PLANE_HOST`, `CONTROL_PLANE_SERVICE_URL`, `FORWARD_AUTH_ADDRESS`,
  `GATEWAY_ENTRYPOINT` (Default `https`, Coolifys Name), `GATEWAY_CERT_RESOLVER`
  (Default `letsencrypt`, aus Coolifys statischer Datei), `TRAEFIK_API_URL`.
- Die Traefik-API (Port 8080) darf nicht ins Internet. Coolifys Proxy
  veroeffentlicht den Port, das Dashboard laeuft mit `api.insecure=false` —
  eine Firewall-Frage. Liegt die Control Plane im Proxy-Netz, erreicht sie die
  API ohne Mapping.
