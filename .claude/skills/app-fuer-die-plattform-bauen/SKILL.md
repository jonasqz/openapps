---
name: app-fuer-die-plattform-bauen
description: Baut eine neue App für die openapps-Plattform (der App-Layer neben Coolify) von leer bis live — Katalog prüfen, create_app, Manifest und OpenAPI zuerst, Migrationen, Route-Handler, Screens aus dem Design System, lokal testen, request_deploy, Review-Befunde beheben, Freigaben vergeben. Nutzen, wenn eine interne App oder ein Agent-Tool auf openapps entstehen soll, oder wenn jemand „neue App", „App anlegen", „deployen", "request_deploy" oder „Review-Gate" sagt.
---

# App für die Plattform bauen

Die Plattform ist der App-Layer neben Coolify. Du baust eine App, die hinter dem
gemeinsamen Login liegt, nur ihr eigenes Schema sieht und ihre Funktionen auch
Agents über MCP anbietet.

Lies die Regeln, bevor du anfängst: die Wurzel-`AGENTS.md` des openapps-Repos
oder, wenn du nur den Plattform-MCP hast, den Prompt `how_to_build_app`.

## 1. Prüfen, ob es die App schon gibt

```
list_apps
```

Gibt es sie, arbeite an ihr weiter. Lege keine zweite mit anderem Namen an.

## 2. Repo anlegen

```
create_app  name=<kurz-und-klein>  title=<Klartext>  category=<internal|crm|…>
```

Das legt ein Repo aus dem Starter-Template an. Klone es und arbeite dort.

## 3. Manifest und Spec zuerst

In dieser Reihenfolge, nicht später:

1. `app.json` — Name, Kategorie, Tabellen, angebotene Tools, gewünschte Rechte,
   Env-Variablen, ausgehende Ziele. Die Control Plane leitet daraus Schema,
   DB-Rolle und Freigaben ab.
2. `openapi.yaml` — jede Funktion als Operation mit `operationId` und
   `x-openapps-verb`. Daraus entstehen die MCP-Tools der App.

Erst wenn beides steht, schreibst du Code. Eine UI-Aktion ohne Operation in der
Spec blockiert das Review-Gate.

## 4. Bauen

- Migrationen: eine Datei pro Änderung, aufsteigend numeriert, bestehende nie
  ändern. Kein `create role`, kein `grant`, kein `create schema`.
- Route-Handler: genau die Operationen der Spec.
- Nutzer: nur über `getUser` aus `@openapps/sdk`. Keinen Login bauen, die
  `X-Auth-*`-Header nie selbst lesen.
- Datenbank: nur über den Client aus `@openapps/sdk`, auf dem eigenen Schema.
- Screens: nur mit `@openapps/ui`. Keine eigenen Farbwerte, keine zweite
  UI-Bibliothek, jede Liste mit leerem und Fehlerzustand.
- Secrets: nur über Env, im Manifest deklariert.

## 5. Lokal prüfen

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Rot heißt rot. Das Gate prüft dasselbe noch einmal.

## 6. Deploy anfordern

```
request_deploy  app=<name>  ref=<git-sha-oder-tag>
```

Das startet `gitleaks`, `semgrep`, den UI-Linter, die Tool-Paritätsprüfung, den
Manifest-Abgleich und das Claude-Review. Alles läuft, nichts wird übersprungen.

## 7. Befunde beheben

Das Gate nennt pro Befund die Datei und die Regel. Die häufigsten:

| Befund | Was du tust |
| --- | --- |
| Secret im Code | Wert nach Env, Variable im Manifest deklarieren, Secret rotieren |
| UI-Aktion ohne Tool | Operation in `openapi.yaml` nachtragen |
| Eigener Farbwert | Token aus `@openapps/ui` nehmen |
| Fremde UI-Bibliothek | entfernen, Komponente aus `@openapps/ui` nutzen |
| Liste ohne leeren/Fehlerzustand | Muster aus `@openapps/ui` importieren |
| DB-Zugriff außerhalb des Schemas | über eine Freigabe in der Control Plane lösen, nicht über eine zweite Verbindung |
| Manifest passt nicht zum Code | Manifest nachziehen |

Dann wieder `request_deploy`. Ein Claude-Review allein gibt nie frei — die
deterministischen Scanner müssen grün sein.

## 8. Freigeben

```
grant  subject=group:<team>   verb=read   resource=app:<name>
grant  subject=agent:<id>     verb=read   resource=tool:<name>.list
```

Erst danach kommt ein Mensch in die App und erst danach sind die MCP-Tools für
einen Agent sichtbar. Default-Deny: Was nicht freigegeben ist, ist gesperrt.
`revoke` wirkt sofort.

## 9. Wenn etwas kaputt ist

```
rollback  app=<name>
```

Setzt in unter zwei Minuten auf die Vorversion zurück. Danach den Fehler
beheben und neu durch dieselbe Pipeline.
