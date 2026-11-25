# Aufgaben

Team-Aufgaben auf der openapps-Plattform: Titel, zuständige Person,
Fälligkeitsdatum, erledigt ja/nein. Menschen nutzen die Liste unter
`/aufgaben`, Agents dieselben Funktionen als Tools.

## Tools

| Tool                 | Verb  | Was es tut                                         |
| -------------------- | ----- | -------------------------------------------------- |
| `aufgaben.list`      | read  | Aufgaben, offene zuerst, Filter erledigt/zuständig |
| `aufgaben.create`    | write | Aufgabe anlegen (titel, zustaendig, faelligAm)     |
| `aufgaben.erledigen` | write | Aufgabe als erledigt markieren (id)                |

Im MCP heißen sie `aufgaben__aufgaben.list` usw., Argumente gehen ins Feld
`args`. Die Oberfläche ruft dieselben Handler (`src/app/actions.ts`).

## Aufbau

- `app.json`, `openapi.yaml`, `src/lib/tools.ts` nennen dieselben Tools;
  `src/lib/tools.test.ts` hält sie deckungsgleich.
- `migrations/0001_aufgaben.sql` — die Tabelle `aufgaben`.
- `seeds/` — Beispieldaten, nur lokal.

## Lokal

```bash
pnpm --filter ./standard-apps/aufgaben typecheck
pnpm --filter ./standard-apps/aufgaben test
./infra/lokal/apps-ausrollen.sh aufgaben
```
