# @openapps/app-manifest

Das maßgebliche Schema für `app.json` plus die Katalog-Quellen-Abstraktion.
`docs/04-app-manifest.md` beschreibt die Absicht, dieses Paket die Form. Weicht
eine Beschreibung vom Code ab, gilt der Code.

## Was drin ist

- `appManifestSchema` — zod-Schema für `app.json`, `strict` (ein unbekanntes
  Feld ist ein Fehler, kein stiller Durchlauf).
- `validateAppManifest(input)` — prüft und sammelt alle Befunde, statt beim
  ersten zu werfen. Für das Review-Gate.
- `parseAppManifest(input)` / `parseAppManifestJson(text)` — werfen
  `ManifestValidationError` mit lesbaren Pfaden.
- `appManifestJsonSchema()` und `schema/app.schema.json` — JSON-Schema für
  Agents und Werkzeuge ohne TypeScript.
- `CatalogSource` — das Interface, über das die Control Plane Apps liest.
- `LocalCatalogSource` — die einzige Quelle in v1.

## Felder

| Feld | Warum |
| --- | --- |
| `manifestVersion` | Version des Formats, nicht der App. Derzeit `1`. |
| `name`, `displayName`, `description`, `category` | Katalog-Eintrag. `name` ist der Slug und der Namensraum für Schema und Tools. |
| `version` | Exaktes Semver. Keine Ranges — ein Deploy hängt an einer Version. |
| `requiredTables` | Tabellen im eigenen Schema der App (AGENTS.md Regel 2). |
| `offeredTools` | MCP-Tools, erzeugt aus `openapi.yaml` (Regel 3). `verb` bindet jedes Tool ans Rechtemodell. |
| `requestedGrants` | Gewünschte Rechte im einen Rechtemodell: Subjekt-Art, Verb, Ressource. Ein Antrag, keine Freigabe. |
| `env` | Deklarierte Env-Variablen mit `secret`-Flag (Regel 5). Werte stehen nie im Manifest. |
| `egress` | Erlaubte ausgehende Ziele (Regel 7). Was hier fehlt, ist gesperrt. |
| `source` | Git-URL und Tag. |

## Rechtemodell im Manifest

Drei Achsen, dieselben wie in der Control Plane:

- **Subjekt-Art:** `human`, `group`, `app`, `agent`
- **Verb:** `read`, `write`, `execute`
- **Ressource:** `{ kind: 'app' | 'table' | 'view' | 'tool', app, name }`

`subjectId` darf fehlen, wenn die Gruppe erst bei der Installation bekannt ist —
die Control Plane fragt sie beim Freigeben ab. Default-Deny bleibt in jedem Fall:
Ein Eintrag hier öffnet nichts, er beantragt.

## Das JSON-Schema

`schema/app.schema.json` wird beim `build` aus dem zod-Schema erzeugt
(`zod-to-json-schema`) und ist als `@openapps/app-manifest/app.schema.json`
exportiert. Begründung gegen ein handgepflegtes Schema: Das zod-Schema ist die
eine Quelle der Wahrheit. Ein zweites Schema von Hand würde beim ersten neuen
Feld auseinanderlaufen — und genau solches Auseinanderlaufen soll das
Review-Gate ja finden, nicht selbst verursachen.

## Katalog-Quellen

```ts
const source = new LocalCatalogSource({ directory: '/srv/openapps/catalog' });
const entries = await source.list();
const app = await source.get('projektliste');
```

Erwartetes Layout: `<directory>/<app>/app.json`. Maßgeblich ist `name` im
Manifest; weicht der Ordnername ab, ist das ein Fehler. Es wird nichts
zwischengespeichert — eine Änderung wirkt sofort, dieselbe Regel wie beim
Widerruf von Freigaben.

In v1 gibt es nur diese Quelle. Das Interface existiert jetzt, damit später ein
öffentlicher Community-Katalog und private Kataloge dazukommen, ohne dass sich
Apps oder Control Plane ändern.

## Scripts

```bash
pnpm --filter @openapps/app-manifest build      # tsc + schema/app.schema.json
pnpm --filter @openapps/app-manifest typecheck
pnpm --filter @openapps/app-manifest test
```
