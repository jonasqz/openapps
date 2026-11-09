# Starter App

Vorlage für eine App auf der openapps-Plattform. `create_app` kopiert dieses
Verzeichnis in ein neues Repo.

## Was schon drin ist

- `app.json` — Manifest, nach dem die Control Plane Schema, Rolle und Freigaben
  anlegt
- `openapi.yaml` — zwei Beispiel-Operationen, aus denen die MCP-Tools entstehen
- `migrations/0001_items.sql` — eine Beispiel-Tabelle
- `src/app/api/items/` — die Route-Handler zu den beiden Operationen
- `src/app/page.tsx` — eine Liste mit leerem und Fehlerzustand
- `AGENTS.md` — die Reihenfolge, in der ein Agent hier arbeitet

## Umbenennen, bevor du baust

1. `name`, `title`, `description`, `category` in `app.json`
2. `name` in `package.json`
3. Beispiel-Tabelle `items` durch deine Tabellen ersetzen, in `app.json`,
   `openapi.yaml` und einer **neuen** Migration

## Lokal

```bash
cp .env.example .env
pnpm dev
```

Ohne Gateway gibt es lokal keinen Nutzer: `getUser` wirft, weil keine gültige
Signatur anliegt. Zum lokalen Aufrufen erzeugst du die fünf `X-Auth-*`-Header
mit `signatureFor` aus `@openapps/sdk` — dieselbe Funktion, die das Gateway
benutzt — und setzt `OPENAPPS_AUTH_SECRET`, `OPENAPPS_APP_ID` und
`OPENAPPS_APP_HOST` passend dazu. Baue keinen Umweg, der die Prüfung lokal
abschaltet: er landet irgendwann in Produktion.
