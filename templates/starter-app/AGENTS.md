# Diese App

> Du baust eine App für die openapps-Plattform. Die Regeln der Plattform stehen
> in der Wurzel-[`AGENTS.md`](../../AGENTS.md) und gelten ohne Ausnahme. Diese
> Datei sagt, wo in dieser Vorlage was hingehört.

## Reihenfolge, in der du arbeitest

1. `app.json` — Name, Kategorie, Tabellen, Tools, Rechte, Env. Zuerst, denn
   daraus leitet die Plattform Schema, Rolle und Freigaben ab.
2. `openapi.yaml` — jede Funktion als Operation, mit `operationId` und
   `x-openapps-verb` (`read`, `write` oder `execute`). Daraus entstehen die
   MCP-Tools. Eine UI-Aktion ohne Operation hier blockiert das Review-Gate.
3. `migrations/` — eine SQL-Datei pro Änderung, aufsteigend numeriert. Nie eine
   bestehende Migration ändern. Kein `create role`, kein `grant`, kein
   `create schema`: das macht die Control Plane.
4. `src/app/api/` — die Route-Handler, genau die Operationen aus der Spec.
5. `src/app/` — die Screens, erst jetzt. Nur mit `@openapps/ui`.

## Wo dein Pfad herkommt

Die App ist unter `https://<domain>/<app-name>` erreichbar, nicht unter einer
eigenen Subdomain (ADR 0007). `next.config.js` setzt diesen Pfad als `basePath`
aus `OPENAPPS_APP_BASE_PATH`; die Control Plane setzt die Variable pro
Deployment. Lass die Zeile, wie sie ist, und schreibe den Pfad nirgends fest —
das Review-Gate prueft beides.

Was daran haengt: Jeder absolute Pfad, den du selbst schreibst, umgeht den
`basePath`. `<img src="/logo.png">` und `fetch('/api/items')` landen auf der
Plattform, nicht in deiner App. Nimm `next/link` und `next/image` (die rechnen
den `basePath` ein) und rufe eigene Endpunkte relativ auf.

## Wo du den Nutzer bekommst

```ts
import { getUser } from '@openapps/sdk';

const user = await getUser(request.headers); // wirft, wenn der Aufruf nicht durch das Gateway kam
```

Baue keinen Login. Lies die Header `X-Auth-*` nie selbst — nur über `getUser`,
weil nur das SDK prüft, dass der Aufruf wirklich durch das Gateway kam.

## Wo du die Datenbank bekommst

```ts
import { db } from '@openapps/sdk';

const rows = await db.query('select id, title, created_at from items order by created_at desc');
```

Der Client ist auf dein Schema festgelegt. Fremde Daten nur über eine Freigabe,
die in der Control Plane vergeben wurde — nie über eine zweite Verbindung.

## Wo die UI herkommt

```ts
import { Button, Table, EmptyState, ErrorState } from '@openapps/ui';
```

Keine eigenen Farbwerte, keine zweite UI-Bibliothek. Jede Liste hat einen leeren
und einen Fehlerzustand. Der Linter blockiert den Rest.

## Vor dem ersten Deploy

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Dann `request_deploy` über den Plattform-MCP. Was das Gate blockiert, steht in
der Wurzel-`AGENTS.md`.
