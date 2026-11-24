# CRM

Standard-App von openapps: schlankes CRM für Menschen und Agents. Firmen,
Kontakte, Deals mit Pipeline und Aktivitäten. Liegt unter `/crm`.

## Tools

Jede Funktion ist zuerst ein Tool (`POST /crm/api/tools/<name>`), beschrieben
in `openapi.yaml` und `app.json`. Die Oberfläche ruft dieselben Handler.

| Tool | Verb | Was |
| --- | --- | --- |
| `companies.list` | read | Firmen, optional mit Suche `q` |
| `companies.get` | read | Firma mit Kontakten, Deals, letzten 20 Aktivitäten |
| `companies.create` | write | Firma anlegen |
| `contacts.list` | read | Kontakte, Suche `q`, Filter `companyId` |
| `contacts.get` | read | Kontakt mit Deals und Aktivitäten |
| `contacts.create` | write | Kontakt anlegen, E-Mail eindeutig |
| `contacts.update` | write | Kontakt ändern, `null` löscht ein Feld |
| `deals.list` | read | Deals, Filter `stage`, `companyId` |
| `deals.create` | write | Deal anlegen, Betrag in Cent |
| `deals.update_stage` | write | Stage setzen, schreibt automatisch eine Aktivität |
| `activities.log` | write | Notiz, Anruf, Mail oder Termin erfassen |
| `activities.list` | read | Verlauf, neueste zuerst |
| `pipeline.summary` | read | Anzahl, Summe, gewichtete Summe je Stage |

## Aufbau

- `migrations/0001_crm.sql` — Tabellen, Prüfungen, Indizes
- `migrations/0002_beispieldaten.sql` — vier erfundene Firmen mit Kontakten,
  Deals und Aktivitäten
- `src/instrumentation.ts` — spielt die Migrationen beim Start ein
- `src/lib/schemas.ts` — Argumente jedes Tools (zod, strikt)
- `src/lib/crm.ts` — Datenzugriff
- `src/lib/pipeline.ts` — Pipeline-Rechnung als reine Funktion
- `src/lib/tools.ts` — die Tool-Tabelle, genutzt von der Route und der UI
- `src/app/api/tools/[tool]/route.ts` — `createToolRoute`
- `src/app/actions.ts` — Server-Actions der Formulare, rufen die Tools

## Tests

```bash
pnpm test
```

Der Test gegen ein echtes Postgres (`src/lib/crm.db.test.ts`) läuft nur mit
`CRM_TEST_DATABASE_URL` und `CRM_TEST_DATABASE_SCHEMA`. Er braucht ein leeres
Schema, das der App-Rolle gehört, und eine Rolle ohne `SUPERUSER` und
`BYPASSRLS`:

```sql
create role app_crm login password '…' nosuperuser nobypassrls;
create schema app_crm authorization app_crm;
```

## Lokal

```bash
cp .env.example .env
pnpm dev
```

Ohne Gateway gibt es keinen Nutzer. Tool-Aufrufe und Formulare brauchen die
fünf `X-Auth-*`-Header, signiert mit `signatureFor` aus `@openapps/sdk`, und
einen `X-Forwarded-Host` gleich `OPENAPPS_APP_HOST`.
