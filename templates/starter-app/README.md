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

Ohne Gateway gibt es lokal keinen Nutzer. Setze `OPENAPPS_GATEWAY_SECRET` und
rufe mit den `X-Auth-*`-Headern plus Signal auf — oder nutze den Dev-Modus des
SDK, der einen festen Testnutzer liefert und in Produktion nicht greift.
