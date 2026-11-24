# ADR 0015: Neue Apps entstehen lokal ohne Handgriff

Stand: 24.11.2026

## Kontext

Im lokalen Betrieb (ADR 0011) waren die drei Standard-Apps fest verdrahtet:

- Für jede App gab es einen Dienst in `docker-compose.yml`.
- Die Bau-Schleife im `app.Dockerfile` nannte alle drei.
- `create_app` nahm nur Apps an, deren Ordner es schon gab.

Eine neue App brauchte deshalb drei Handgriffe, bevor ein Assistent an ihr
arbeiten konnte. Und die Vorlage `templates/starter-app` hatte weder einen
Tool-Endpunkt für Agents noch Migrationen beim Start. Eine App daraus hätte
die Lebendprüfung nie bestanden.

## Entscheidung

- **`create_app` legt lokal den Ordner an.** Das lokale Repo-Backend kopiert
  `templates/starter-app` nach `standard-apps/<name>`, ohne Bauartefakte, und
  setzt Name und Beschreibung in `app.json` und `package.json`. Einen
  vorhandenen Ordner fasst es nie an. Die Control Plane darf dafür in
  `standard-apps/` schreiben, die Vorlage sieht sie nur lesend.
- **Ein Dienst und ein Image je App, erzeugt.** `apps-dienste.mjs` schreibt
  `docker-compose.apps.yml` aus allen Ordnern mit `app.json`. Die Datei ist
  gitignoriert. `app.Dockerfile` baut mit `LOKAL_APP` nur die eine App.
  `lokal.sh` ruft Compose immer mit beiden Dateien auf.
- **Ein Befehl zum Ausrollen.** `apps-ausrollen.sh [app…]` bringt den
  Lockfile auf den Stand, baut die Container und deployt durch das
  Review-Gate.
- **Die Vorlage kann, was die Standard-Apps können:**
  - Tools über `createToolRoute`.
  - Migrationen beim Start.
  - Beispieldaten in `seeds/`.
  - Die Seite rendert zur Laufzeit (`dynamic = 'force-dynamic'`). Ohne das
    backt Next den Fehlerzustand schon beim Build ein, weil es dann noch keine
    Datenbank gibt.
- `runSeeds` nimmt eine App ohne `seeds/` hin, statt ihren Start zu
  verhindern.

## Folgen

- Eine neue App läuft lokal so:

  1. `create_app` über den MCP.
  2. Code in `standard-apps/<name>` schreiben.
  3. `./infra/lokal/apps-ausrollen.sh <name>` ausführen.
  4. Tools über `grant` freigeben.

  Für jeden neuen Stand gilt wie auf dem Server: `version` in `app.json`
  erhöhen.

- Geprüft am laufenden Stapel mit einer Test-App `urlaub`: Ordner aus der
  Vorlage, Review bestanden, Migration und Beispieldaten beim Start, das Tool
  über den MCP aufrufbar, die Seite zeigt die Einträge, und ein Update über
  Version 0.1.1 ging durch.
- Neue Apps sind neue Workspace-Pakete, deshalb ändert sich der Lockfile.
  Wer eine App behalten will, committet beides.
- Die Container der Standard-Apps heißen jetzt `app-<name>`, etwa `app-crm`.
- `apps-ausrollen.sh` baut die Images nacheinander. Parallel ging Docker Desktop beim ersten
  Lauf auf frischem Stand der Speicher aus (`cannot allocate memory`), weil jeder Build den ganzen Workspace
  installiert. Eingerichtet wird der lokale Betrieb damit in zwei Befehlen:
  `einrichten.sh` und `apps-ausrollen.sh`.
- Tests: `tests/lokal-backend.spec.ts` (Vorlage, kein Überschreiben, kein
  Pfad als Name) und `packages/sdk/test/migrate.test.ts` (App ohne `seeds/`).

## Alternativen

- **Die Control Plane startet Container selbst** über den Docker-Socket: Das
  hieße Root-Zugriff auf den Rechner für einen Dienst, der Agents bedient.
  Verworfen, wie auf dem Server, wo Coolify baut.
- **Ein Runner-Container für alle Apps**: Der Netz-Alias `openapps-<app>` je
  App wäre dann nicht mehr zu haben, und Router und MCP rechnen mit ihm.
  Verworfen.
- **Den Ordner legt der Assistent selbst an**: Das geht auch. Aber dann wäre
  `create_app` lokal ein anderer Vorgang als auf dem Server, und ein Agent
  müsste wissen, wo die Vorlage liegt. Verworfen.
