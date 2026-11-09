# Regeln der Plattform für Agents

Diese Datei gilt für jeden Agent, der eine **App für diese Plattform** baut.
Wer sich daran hält, kommt beim ersten Deploy durch das Review-Gate.

Die gleiche Anleitung gibt es als Claude-Skill „App für die Plattform bauen“ und
als MCP-Prompt `how_to_build_app` über den Plattform-MCP.

## Die sieben Regeln

1. **Keinen eigenen Login bauen.** Der Nutzer kommt aus den Request-Headern, die
   das Gateway setzt (`X-Auth-User-Id`, `X-Auth-User-Email`, `X-Auth-Groups`).
   Vertraue diesen Headern nur über `@openapps/sdk`, niemals direkt.
2. **Nur das eigene Schema nutzen.** Die App bekommt genau eine DB-Rolle und
   genau ein Schema. Keine Superuser-Verbindung, kein `search_path`-Trick, kein
   Zugriff auf Tabellen anderer Apps. Fremde Daten nur über eine Freigabe, die
   in der Control Plane vergeben wurde.
3. **Jede Funktion zuerst als API.** Beschreibe sie in `openapi.yaml`. Daraus
   erzeugt die Plattform die MCP-Tools der App. Eine UI-Aktion ohne passenden
   API-Endpunkt blockiert das Review-Gate.
4. **Manifest pflegen.** `app.json` beschreibt Name, Kategorie, Version,
   benötigte Tabellen, angebotene Tools, gewünschte Rechte und die Quelle.
   Änderst du Tabellen oder Tools, änderst du das Manifest mit.
5. **Keine Secrets im Code.** Nur über Env-Variablen, deklariert im Manifest.
6. **Nur das Design System.** Komponenten und Tokens aus `@openapps/ui`. Keine
   eigenen Farbwerte, keine zweite UI-Bibliothek. Jede Liste hat einen leeren
   und einen Fehlerzustand, jedes Formular eine Validierung mit sichtbarer
   Fehlermeldung.
7. **Nichts am Gateway vorbei.** Kein ausgehender Netzwerkzugang außer über die
   im Manifest deklarierten Ziele.

## Der Weg von leer bis live

1. `list_apps` — gibt es die App schon?
2. `create_app` — legt ein Repo aus dem Starter-Template an.
3. Lokal bauen und testen, dann pushen.
4. `request_deploy` — startet `gitleaks`, `semgrep`, den UI-Linter und das
   Claude-Review.
5. Bei Freigabe legt die Control Plane Schema, DB-Rolle, Env und
   Auth-Middleware an und deployt über Coolify.
6. `grant` — Freigaben an Gruppen, andere Apps und Agents. Erst danach sind die
   MCP-Tools der App aktiv.
7. Jede neue Version läuft durch dieselbe Pipeline. `rollback` setzt in unter
   2 Minuten auf die Vorversion zurück.

## Was das Review-Gate blockiert

- ein Secret im Code (`gitleaks`)
- ein Befund aus `semgrep` in der Sicherheits-Regelmenge
- eine UI-Aktion ohne passendes MCP-Tool
- ein eigener Farbwert oder eine fremde UI-Bibliothek
- eine DB-Verbindung außerhalb des eigenen Schemas
- ein Manifest, das nicht zum Code passt

Ein Claude-Review ist kein Sicherheitsbeweis. Es läuft immer zusammen mit den
deterministischen Scannern, nie an ihrer Stelle.
