# Roadmap v1

6–8 Wochen, das Riskanteste zuerst. Jede Woche endet mit einem Nachweis, nicht
mit einer Einschätzung.

| Wann | Was | Nachweis am Ende | Abbruch |
| --- | --- | --- | --- |
| Tag 0 | `marmelab/platform` einen Tag testen: Fork als Basis oder Neubau? | ADR in `docs/decisions/` | – |
| Woche 1 | Forward-Auth über Traefik-Labels plus Default-Deny, robust gegen Coolify-Updates | DoD 2: Testskript ruft alle App-Domains ohne Session auf, vor und nach Coolify-Update | Steht nach Woche 1 nicht stabil: Ansatz neu denken |
| Woche 2 | Schema pro App, DB-Rolle pro App, Freigaben zwischen Apps, Rechtemodell | DoD 3: Test blockiert → Freigabe → lesbar → Widerruf → blockiert | – |
| Woche 3 | MCP-Tools pro App aus der OpenAPI-Spec, Agent-Login als eigener OAuth-Client | DoD 6: zwei Agents, mit und ohne Freigabe, plus Log-Eintrag | Laufen nicht sauber: handgeschriebene Tools pro Template |
| Woche 4–6 | Review-Gate (gitleaks, Semgrep, UI-Linter, Claude-Report), Rollback, Plattform-MCP, Starter-Template, Design System | DoD 1, 4, 5 und 7 | – |
| Woche 6–8 | Puffer, erste echte interne Apps live | 3 interne Apps im Alltag | – |

## Danach: 4 Wochen Betrieb

Messen, nicht diskutieren: genutzte Apps, Betriebsaufwand pro Woche, Zeit für
ein Setup auf frischer Coolify-Instanz. Die Schwellen stehen in
[`00-brief.md`](00-brief.md).

## Aktueller Stand

| Baustein | Stand |
| --- | --- |
| Repo-Fundament, Subagents, Doku | steht |
| `packages/app-manifest` | Gerüst |
| `packages/ui` | Gerüst |
| `apps/control-plane` | Gerüst |
| `apps/platform-mcp` | Gerüst |
| `templates/starter-app` | Gerüst |
| Traefik-Forward-Auth | offen (Woche 1) |
