# Wer arbeitet hier

Das Projekt wird von Agents gebaut, koordiniert von einem CoS (Claude Code in
dieser Sitzung). Die Rollen liegen als Subagents in
[`.claude/agents/`](../.claude/agents) und werden mit `@name` oder über den
Agent-Aufruf adressiert.

| Rolle | Datei | Verantwortet | Nicht zuständig |
| --- | --- | --- | --- |
| **coding** | `.claude/agents/coding.md` | Control Plane, Plattform-MCP, SDK, Starter-Template, Migrationen, Tests, CI | Design, Scope |
| **product** | `.claude/agents/product.md` | Scope, DoD, Roadmap, ADRs, Nicht-Ziele | Code |
| **ui** | `.claude/agents/ui.md` | Design System, App-Shell, UX, UI-Guide, UI-Linter | Backend |

## Später

Diese Rollen kommen, wenn die Arbeit sie braucht — nicht vorher:

| Rolle | Wann | Warum |
| --- | --- | --- |
| **security** | Woche 1, mit der Forward-Auth | Die größte Annahme des Projekts ist eine Auth-Annahme. Ein eigener Blick, der nicht am Feature hängt, ist ab dann sinnvoll. |
| **ops** | Woche 4–6, mit Rollback und Betrieb | Coolify, Traefik, Postgres-Rollen, Backups, das 2-h-pro-Woche-Ziel |
| **review** | Woche 4–6, mit dem Review-Gate | Das Gate selbst prüfen: Findet es das eingebaute Secret, blockiert es die fehlende Tool-Parität? |
| **docs** | vor der OSS-Entscheidung | Setup auf frischer Instanz in 30 Min reproduzierbar — das ist eine Doku-Aufgabe |

## Arbeitsteilung

Der CoS schneidet die Arbeit, verteilt sie und hält die Nachweis-Mappe
([`03-dod.md`](03-dod.md)) aktuell. Ein Agent arbeitet in abgegrenzten Pfaden,
committet nicht selbst und berichtet, was läuft und was nachweisbar nicht läuft.
