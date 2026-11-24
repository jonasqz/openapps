# Wiki

Standard-App von openapps: Wissensseiten wie in Notion, für Menschen und Agents.
Seitenbaum, Markdown, Volltextsuche (deutsch) und ein Verlauf, der jede
Änderung mit Autor festhält — auch die von Agents.

## Tools

Jede Funktion ist zuerst ein Tool (`POST <basePath>/api/tools/<name>`), die UI
ruft dieselben Funktionen.

| Tool | Verb | Was es tut |
| --- | --- | --- |
| `pages.list` | read | Seiten ohne Inhalt, Filter `q` (Titel), `parentId`, `tag` |
| `pages.get` | read | Seite mit Inhalt, Eltern und Unterseiten |
| `pages.search` | read | Volltext mit Rang und Ausschnitt (`«Treffer»`) |
| `pages.create` | write | Seite anlegen, optional als Unterseite |
| `pages.update` | write | Titel/Inhalt/Tags ändern oder mit `appendMd` anhängen |
| `pages.archive` | write | Archivieren; nicht, solange Unterseiten leben |
| `pages.history` | read | Verlauf, neueste Änderung zuerst |

Die Beschreibungen für Agents stehen in `app.json`, die Schemas in
`openapi.yaml` und `src/lib/schemas.ts`. Ein Test hält die drei deckungsgleich.

## Aufbau

- `migrations/0001_wiki.sql` — `pages` (mit generierter `tsvector`-Spalte und
  GIN-Index) und `page_revisions`
- `migrations/0002_beispielseiten.sql` — Beispielseiten der fiktiven Nordlicht GmbH
- `src/instrumentation.ts` — führt die Migrationen beim Start aus
- `src/lib/pages.ts` — Datenzugriff, eine Funktion je Tool
- `src/lib/tools.ts`, `src/app/api/tools/[tool]/route.ts` — die Tool-Route
- `src/app/actions.ts` — Server Actions der UI, prüfen `getUser` und rufen
  dieselben Funktionen
- `src/lib/markdown.ts`, `src/components/Markdown.tsx` — eigener, kleiner
  Markdown-Renderer ohne `dangerouslySetInnerHTML`; Links nur http(s)

## Lokal

```bash
cp .env.example .env
pnpm dev
```

Ohne `DATABASE_URL` startet die App, überspringt die Migrationen mit einer
Warnung und zeigt auf jeder Seite den Fehlerzustand.

## Tests

```bash
pnpm test
```

Die Datenbank-Tests (`src/lib/pages.db.test.ts`) laufen nur mit
`WIKI_TEST_DATABASE_URL` und `WIKI_TEST_DATABASE_SCHEMA` — als App-Rolle (kein
Owner, kein Superuser) mit eigenem, leerem Schema. Sonst werden sie
übersprungen.
