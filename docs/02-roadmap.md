# Roadmap v1

6–8 Wochen, das Riskanteste zuerst. Jede Woche endet mit einem Nachweis, nicht
mit einer Einschätzung.

| Wann | Was | Nachweis am Ende | Abbruch |
| --- | --- | --- | --- |
| Tag 0 | `marmelab/platform` einen Tag testen: Fork als Basis oder Neubau? | [ADR 0003](decisions/0003-marmelab-platform-fork-oder-neubau.md), Feld „Entscheidung" gefüllt | – |
| Woche 1 | Forward-Auth plus Default-Deny, robust gegen Coolify-Updates — [Spec](specs/woche-1-forward-auth.md) | DoD 2: Testskript ruft alle App-Domains ohne Session auf, vor und nach Coolify-Update | Steht nach Woche 1 nicht stabil: Ansatz neu denken |
| Woche 2 | Schema pro App, DB-Rolle pro App, Freigaben zwischen Apps, Rechtemodell | DoD 3: Test blockiert → Freigabe → lesbar → Widerruf → blockiert | – |
| Woche 3 | MCP-Tools pro App aus der OpenAPI-Spec, Agent-Login als eigener OAuth-Client | DoD 6: zwei Agents, mit und ohne Freigabe, plus Log-Eintrag | Laufen nicht sauber: handgeschriebene Tools pro Template |
| Woche 4–6 | Review-Gate (gitleaks, Semgrep, UI-Linter, Claude-Report), Rollback, Plattform-MCP, Starter-Template, Design System | DoD 1, 4, 5 und 7 | – |
| Woche 6–8 | Puffer, erste echte interne Apps live | 3 interne Apps im Alltag | – |

## Danach: 4 Wochen Betrieb

Messen, nicht diskutieren: genutzte Apps, Betriebsaufwand pro Woche, Zeit für
ein Setup auf frischer Coolify-Instanz. Die Schwellen stehen in
[`00-brief.md`](00-brief.md).

## Aktueller Stand

Stand 2026-11-09. `pnpm check` ist grün: 9 Pakete typegeprüft, 6 gelintet,
291 Tests bestanden, 1 übersprungen, 9 als `todo` sichtbar offen.

| Baustein | Stand |
| --- | --- |
| Repo-Fundament, Subagents, Doku | steht |
| `packages/app-manifest` | Schema, Validierung, Katalog-Quellen, generiertes JSON-Schema — 15 Tests |
| `packages/sdk` | Gateway-Signal (HMAC) und schema-gebundener DB-Client — 54 Tests |
| `packages/ui` | Tokens, 15 Komponenten, 5 Muster, App-Shell, 4 Linter-Regeln — 173 Tests, gerendert geprüft |
| `apps/control-plane` | Domäne, Rechtemodell, Review-Gate, Rollback, Forward-Auth-Route — 39 Tests, davon 4 gegen echtes Postgres |
| `apps/platform-mcp` | sechs Tools, App-Tool-Weiterleitung, `how_to_build_app` — 6 Tests |
| `templates/starter-app` | Manifest, OpenAPI, Migration, Handler, Liste, UI-Linter verdrahtet — 4 Tests |
| Woche-1-Spec zur Forward-Auth | steht ([`specs/woche-1-forward-auth.md`](specs/woche-1-forward-auth.md)) |
| Nachweis-Mappe `docs/nachweise/` | Vorlagen stehen, kein Lauf gegen echte Infrastruktur |
| Prüfskript DoD 2 | steht (`infra/scripts/check-auth.sh`), noch kein Lauf |
| Traefik-Konfiguration | **offen** — Entrypoint-Middleware, Catch-all-Router, Deny-Backend |
| Better Auth | **offen** — verdrahtet ist `denyAllSessions`, niemand kommt herein |

## Was als Nächstes dran ist

In dieser Reihenfolge, weil das Riskanteste zuerst kommt:

1. **Traefik-Entrypoint plus Deny-Backend** (`infra/traefik/`, Spec 1.2). Die
   App-seitigen Labels stehen, der Default-Deny am Entrypoint fehlt — und der
   ist der wichtigere Teil von DoD 2.
2. **Better Auth verdrahten.** Ohne Session ist die Plattform nicht benutzbar;
   `denyAllSessions` ist der richtige Zwischenzustand, aber eben ein
   Zwischenzustand.
3. **Tag 0 entscheiden** ([ADR 0003](decisions/0003-marmelab-platform-fork-oder-neubau.md)).
4. **ADR 0005 umsetzen:** ein Vokabular für Subjekte.
5. **Scanner wirklich laufen lassen** — gitleaks und semgrep als Prozess gegen
   ein Test-Repo mit eingebautem Secret (DoD 4).

## Bekannte Schulden

| Schuld | Warum sie jetzt in Kauf genommen ist |
| --- | --- |
| `platform-mcp` bindet die Domäne der Control Plane als TypeScript-Quelle ein und läuft über `tsx` | Der richtige Schnitt wäre ein eigenes Paket unter `packages/`. Das ist ein Umbau, der nichts an den Kriterien ändert — später, nicht jetzt. |
| Zwei Wörter für Subjekte (`user` in der Datenbank, `human` im Manifest), übersetzt an einer Stelle | [ADR 0005](decisions/0005-ein-vokabular-fuer-subjekte.md) entscheidet `human`; die Migration fehlt noch. |
| `better-auth` verlangt `zod` 4, im Repo liegt 3.24 | Nur eine Peer-Warnung, noch kein Fehler. Fällt an, wenn Better Auth verdrahtet wird. |
| `@openapps/ui` liefert Quellcode, also müssen alle Apps dieselben React-Typen fahren (18) | Bewusst: lesbar für Agents, keine Stale-Build-Fehler. Preis ist die gemeinsame Typversion. |
| Test-Postgres läuft auf `postgres:16`, nicht 17 | Das Image lag lokal vor und die Nachweise sind dagegen **gelaufen**. Ein verifiziertes Image ist mehr wert als ein neueres, das nur vermutet ist. |
