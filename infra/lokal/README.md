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
docker compose -f infra/lokal/docker-compose.yml --env-file infra/lokal/.env up -d --build
```

```bash
./infra/lokal/apps-ausrollen.sh
```

- `einrichten.sh` legt `.env` mit Zufalls-Secrets und ein selbst signiertes
  Zertifikat an. Beides bleibt auf dem Rechner und ist gitignoriert.
- `apps-ausrollen.sh` registriert und deployt die Apps aus `standard-apps/` und
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

## Was lokal fehlt

- **Login für Menschen.** Er geht über Google und braucht eigene
  Zugangsdaten (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` in `.env`, Redirect
  `https://cp.local.test:8443/api/auth/callback/google`) sowie in `/etc/hosts`
  die Einträge `cp.local.test` und `apps.local.test` auf `127.0.0.1`. Ohne das
  bleiben die Oberflächen der Apps hinter der Forward-Auth. Genau so soll es
  sein.
- **Ein Inventar des Backends.** Ob ein App-Container Ports oder
  Traefik-Labels hat, kann der lokale Adapter nicht messen. Er meldet „nicht
  erreichbar“ statt „sauber“.
- **Rollback auf einen alten Stand.** Lokal gibt es nur den Stand auf der
  Platte.

## Aufräumen

```bash
docker compose -f infra/lokal/docker-compose.yml --env-file infra/lokal/.env down -v
```
