---
name: app-fuer-die-plattform-bauen
description: Baut eine neue App für die openapps-Plattform oder ändert eine bestehende, von der Idee bis live. Die Schritte sind create_app, Manifest, Migrationen, Tools für Agents, Screens aus dem Design System, Ausrollen durch das Review-Gate und Freigaben. Nutzen, wenn eine interne App oder ein Agent-Tool auf openapps entstehen oder sich ändern soll, oder wenn jemand „neue App“, „App anlegen“, „App ändern“, „deployen“, „request_deploy“ oder „Review-Gate“ sagt.
---

# App für die Plattform bauen oder ändern

openapps ist der App-Layer neben Coolify. Eine App:

- liegt hinter dem gemeinsamen Login, ohne eigenen Login-Code;
- sieht nur ihr eigenes Schema in Postgres;
- bietet ihre Funktionen auch Agents an, als Tools über den Plattform-MCP;
- nutzt für ihre Oberfläche nur das Design System `@openapps/ui`.

Wer was darf, entscheidet die Plattform. In der App steht kein Rechte-Code.

Die verbindlichen Regeln liefert der MCP-Prompt `how_to_build_app`. Im
openapps-Repo stehen sie auch in `AGENTS.md`. Lies sie, bevor du anfängst.

## 0. Wo bist du?

- **Lokal:** Du arbeitest im openapps-Repo und der MCP läuft auf
  `http://localhost:8080/mcp`. Apps liegen in `standard-apps/<name>`.
  Ausgerollt wird mit `./infra/lokal/apps-ausrollen.sh <name>`.
- **Server:** Jede App hat ihr eigenes Git-Repo. Ausgerollt wird mit
  `request_deploy` und einem gepushten Commit.

Wenn unklar ist, wo du bist, sieh nach, ob es `infra/lokal/lokal.sh` gibt.

## 1. Gibt es die App schon?

Rufe `list_apps` auf. Gibt es die App schon, arbeite an ihr weiter (Abschnitt
„App ändern“). Lege keine zweite unter anderem Namen an.

## 2. Neue App anlegen

Rufe `create_app` auf:

- `name`: kurz und klein, `a-z`, Ziffern, Bindestrich.
- `displayName`: Klartext.
- `manifest`: das `app.json` der Vorlage mit deinem Namen, deiner Beschreibung
  und deiner Kategorie.

Das legt Repo bzw. Ordner aus der Vorlage an und richtet Schema und DB-Rolle
ein. Lokal steht die App danach in `standard-apps/<name>`.

Die Vorlage bringt schon mit:

- Tool-Endpunkt: `src/app/api/tools/[tool]/route.ts` mit `createToolRoute`
- Tools: `src/lib/tools.ts`
- Migrationen beim Start: `src/instrumentation.ts`
- Beispieldaten in `seeds/`, die nur lokal eingespielt werden
- eine Listen-Seite mit leerem Zustand und Fehlerzustand

## 3. Manifest zuerst

Pflege `app.json`, bevor du Code schreibst:

- `requiredTables`: die Tabellen deiner App.
- `offeredTools`: jedes Tool mit `name` (etwa `antraege.list`), Beschreibung
  und `verb`, also `read` oder `write`. Genau diese Namen stehen auch in
  `src/lib/tools.ts`.
- `env`: Variablen, die die App braucht. Secrets nur als Variable, nie als
  Wert.
- `version`: Erhöhe sie bei jedem neuen Stand, sonst lehnt das Review-Gate ab.

## 4. Bauen

- **Migrationen:** eine Datei je Änderung in `migrations/`, aufsteigend
  nummeriert (`0002_…sql`). Eine bestehende änderst du nie. Kein
  `create role`, kein `grant`, kein `create schema`.
- **Beispieldaten:** in `seeds/`, nicht in `migrations/`. Sonst landen sie auf
  dem Server.
- **Tools für Agents:** in `src/lib/tools.ts`, Eingaben mit `parseArgs` und
  zod. Falsche Eingaben ergeben eine Meldung, aus der der Agent lernen kann.
- **Nutzer:** nur über `getUser` bzw. `ctx.user` aus `@openapps/sdk`. Ein
  Agent erscheint als `agent:<name>`. Speichere ihn als Urheber.
- **Datenbank:** nur über den Pool aus `@openapps/sdk`, im eigenen Schema.
- **Screens:**
  - Nur Komponenten aus `@openapps/ui`, etwa `Table`, `FormPattern`,
    `DetailPattern`, `Input`, `Textarea`.
  - Keine eigenen Farbwerte, keine zweite UI-Bibliothek.
  - Jede Liste hat einen leeren Zustand und einen Fehlerzustand.
  - Seiten mit Daten brauchen `export const dynamic = 'force-dynamic'`.
  - Verweise innerhalb der App gehen über `next/link`, weil die App unter
    `/<name>` läuft.

## 5. Prüfen

```bash
pnpm --filter ./standard-apps/<name> typecheck
pnpm --filter ./standard-apps/<name> test
```

Rot heißt rot. Das Review-Gate prüft dasselbe noch einmal.

## 6. Ausrollen

**Lokal:**

```bash
./infra/lokal/apps-ausrollen.sh <name>
```

Das baut den Container und deployt durch das Review-Gate. Danach ist die App
unter `http://127.0.0.1:8090/<name>` zu sehen.

**Server:** Committe und pushe. Dann rufe `request_deploy` auf, mit `app`,
`version` aus `app.json` und `gitSha` des gepushten Commits.

Das Review-Gate führt `gitleaks`, `semgrep` und die Prüfungen der Plattform
aus. Nennt es Befunde, behebe sie (Datei und Regel stehen dabei), erhöhe die
Version und rolle neu aus. Ein Befund wird nie umgangen.

## 7. Freigeben

Ohne Freigabe sieht niemand etwas, das ist Default-Deny. Vergib nur, was der
Auftrag verlangt:

- Menschen: `grant` mit `subjectKind: group`, `verb: read`,
  `resourceKind: app`, `resourceId: <name>`.
- Agents: je Tool `grant` mit `subjectKind: agent`, `verb: execute`,
  `resourceKind: tool`, `resourceId: <name>.<tool>`.

Im MCP heißen App-Tools `<name>__<tool>`, jeder Punkt wird zu `__`. Aus
`aufgaben.create` in der App `aufgaben` wird `aufgaben__aufgaben__create`.
Die Argumente gehen ins Feld `args`. Mit `list_grants` siehst du deine eigenen
Freigaben.

Die Liste der Tools stellt der MCP beim Verbinden zusammen. Ein Tool, das du
gerade erst freigegeben hast, siehst du deshalb erst nach einer neuen
Verbindung (in Claude Code über `/mcp` oder eine neue Sitzung). Das ist kein
Fehler der Freigabe.

## App ändern

1. Lies `app.json`, `src/lib/tools.ts` und die betroffenen Seiten.
2. Neue Spalten oder Tabellen kommen als neue Migration.
3. Ein neues Tool trägst du in `app.json` und in `src/lib/tools.ts` ein.
4. Erhöhe die `version`, prüfe und rolle aus wie oben.
5. Ist das Tool neu, gib es den Agents frei, die es brauchen.

## Wenn etwas kaputt ist

Auf dem Server setzt `rollback` die App auf die Vorversion zurück. Danach
behebst du den Fehler und rollst über denselben Weg neu aus.
