# Diese App: wissen

> Die Regeln der Plattform stehen in der Wurzel-[`AGENTS.md`](../../AGENTS.md)
> und gelten ohne Ausnahme. Diese Datei sagt, wo in dieser App was liegt.

## Wo was liegt

- `app.json` — Manifest: Tabellen `documents`, `chunks`; Tools `search`,
  `documents.add`, `documents.list`, `documents.get`, `documents.delete`.
- `openapi.yaml` — jede Operation ist `POST /tools/<toolname>` mit
  `operationId` und `x-openapps-verb`. Ein Test prüft, dass Manifest, Spec und
  Handler übereinstimmen.
- `migrations/` — eine SQL-Datei pro Änderung, nie eine bestehende ändern.
  Kein `create role`, kein `grant`, kein `create schema`.
- `src/app/api/tools/[tool]/route.ts` — der einzige API-Endpunkt,
  `createToolRoute` aus `@openapps/sdk`.
- `src/lib/tools.ts` — Tool-Name → Handler. Ein neues Tool kommt hier,
  in `app.json` und in `openapi.yaml` dazu, sonst wird der Test rot.
- `src/lib/retriever.ts` — die Schnittstelle `Retriever` und die
  Volltext-Implementierung.
- `src/lib/chunk.ts` — das Zerlegen, eine reine Funktion.
- `src/app/actions.ts` — Server Actions der UI. Jede prüft zuerst `getUser`
  und ruft dieselbe Fachlogik wie das passende Tool.

## Was hier nicht hineingehört

Kein Login, keine Rechteprüfung, kein Lesen der `X-Auth-*`-Header außer über
`getUser`. Wer was darf, entscheidet die Control Plane.
