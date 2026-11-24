# Lokaler Betrieb: die Plattform mit Standard-Apps auf dem eigenen Rechner

Die ganze Plattform läuft in Docker, ohne Coolify und ohne GitHub (ADR 0011).
Dazu kommen drei Standard-Apps:

| App      | Pfad      | Wofür                                                                             |
| -------- | --------- | --------------------------------------------------------------------------------- |
| `wiki`   | `/wiki`   | Seiten wie in Notion: Markdown, Unterseiten, Verlauf, Volltextsuche               |
| `crm`    | `/crm`    | Firmen, Kontakte, Deals mit Pipeline, Aktivitäten                                 |
| `wissen` | `/wissen` | Dokumente ablegen und Passagen mit Quelle finden (die Retrieval-Hälfte eines RAG) |

Gleich wie auf dem Server:

- Die Control Plane legt Schema und Rolle je App an, setzt die Env und schreibt
  die Gateway-Konfiguration.
- Jede App läuft erst nach dem Review-Gate mit echtem gitleaks und semgrep.
- Agents kommen nur über den Plattform-MCP an die Apps, mit Freigabe pro Tool
  und Eintrag im Audit-Log.

## Starten

```bash
./infra/lokal/einrichten.sh
```

```bash
./infra/lokal/apps-ausrollen.sh
```

- `einrichten.sh` legt `.env` mit Zufalls-Secrets und ein selbst signiertes
  Zertifikat an. Beides bleibt auf dem Rechner und ist gitignoriert.
- `lokal.sh` ist `docker compose` für diesen Stapel. Es legt für jede App in
  `standard-apps/` einen eigenen Container an (ADR 0015).
- `apps-ausrollen.sh` baut die Images nacheinander, startet den Stapel,
  registriert und deployt die Apps aus `standard-apps/` und
  legt den Agenten `betrieb` an. Der darf, was die Gruppe `platform-admins`
  darf. Sein Token liegt danach in `infra/lokal/.agents/betrieb.token` (Modus 0600) und wird nie angezeigt.
- Ein zweiter Lauf legt nichts doppelt an. Ein geänderter Stand einer App wird
  neu deployt.

## Einen Agenten anschließen

Der MCP liegt lokal auf `http://localhost:8080/mcp`, nur auf dem Loopback.

```bash
claude --mcp-config infra/lokal/.agents/mcp-betrieb.json
```

`betrieb` legt dann über MCP Arbeits-Agents an und vergibt Freigaben. Jedes
App-Tool ist einzeln freizugeben (`execute` auf `<app>.<tool>`). Ein Agent sieht
nur die Tools, die er darf. Ruft er ein anderes trotzdem auf, wird er blockiert,
und beides steht im Protokoll. Im MCP heißen App-Tools `<app>__<tool>` mit `__`
statt Punkt, weil Clients keine Punkte im Namen annehmen.

## Eine App ändern oder neu bauen lassen

Mit deinem Claude Code im Repo, verbunden mit dem Plattform-MCP:

```bash
claude --mcp-config infra/lokal/.agents/mcp-betrieb.json
```

- **Neue App:** Zum Beispiel „Bau mir eine App für Urlaubsanträge“. Der
  Assistent ruft dann `create_app` auf. Das legt `standard-apps/<name>` aus der
  Vorlage an, mit Tool-Endpunkt, Migrationen und Beispieldaten. Dann schreibt
  er den Code und rollt aus.
- **App ändern:** Zum Beispiel „Füge im CRM ein Feld Lead-Quelle an Deals
  hinzu“. Neue Spalten kommen als neue Migration. Danach erhöht der Assistent
  `version` in `app.json` und rollt aus.

Ausrollen, für eine App oder ohne Namen für alle:

```bash
./infra/lokal/apps-ausrollen.sh <name>
```

Danach ist die App unter <http://127.0.0.1:8090/name> zu sehen. Agents
erreichen ihre Tools, sobald sie über `grant` freigegeben sind.

## Prüfen, dass Agents durchkommen

```bash
pnpm --filter @openapps/platform-mcp test:lokal
```

Der Test geht dieselben Wege wie ein Agent: `betrieb` legt zwei Agents an und
gibt einzelne Tools frei. Danach ruft jeder Agent seine Tools mit Argumenten
auf. Ein nicht freigegebenes Tool und eine Selbstfreigabe werden abgelehnt.
Der Agent steht in der App als Urheber, und nach einer Sperre kommt er nicht
mehr herein. Der Test braucht kein Sprachmodell und liefert bei jedem Lauf
dasselbe Ergebnis.

## Die Oberflächen ansehen

- **Apps:** <http://127.0.0.1:8090>, angemeldet als `ansicht@local.test`
  (ADR 0013).
- **Verwaltung (Control Plane):** <http://127.0.0.1:8091>. Dort verwaltest du
  Apps, Agents und Freigaben (ADR 0014). Standard ist der lokale Admin. Als
  Nutzer ohne Freigaben schaust du über
  <http://127.0.0.1:8091/_lokal/als/nutzer>, zurück geht es über
  <http://127.0.0.1:8091/_lokal/als/admin>.

Beides umgeht den Google-Login und läuft deshalb nur lokal, nur am Loopback.

## Was lokal fehlt

- **Login für Menschen.** Er geht über Google und braucht eigene
  Zugangsdaten (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` in `.env`, Redirect
  `https://cp.local.test:8443/api/auth/callback/google`) sowie in `/etc/hosts`
  die Einträge `cp.local.test` und `apps.local.test` auf `127.0.0.1`. Ohne das
  bleibt der Weg über `cp.local.test` und `apps.local.test` hinter dem
  Login. Apps und Verwaltung zeigt der Ansehen-Proxy auch ohne ihn.
- **Ein Inventar des Backends.** Ob ein App-Container Ports oder
  Traefik-Labels hat, kann der lokale Adapter nicht messen. Er meldet „nicht
  erreichbar“ statt „sauber“.
- **Rollback auf einen alten Stand.** Lokal gibt es nur den Stand auf der
  Platte.

## Aufräumen

```bash
./infra/lokal/lokal.sh down -v
```
