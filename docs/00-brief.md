# Build Brief: Coolify App-Layer

Stand 2026-11-09 · Jonas Quilitz

Quelle: das gemeinsame Dokument
[Build Brief: Coolify App-Layer](https://claude.ai/artifact/FiPrvX27HyH98kMxGSiofA).
Diese Datei ist die Arbeitsfassung im Repo. Weicht sie vom Dokument ab, gilt das
Dokument.

## Ziel

Wir bauen einen schlanken Layer neben Coolify für das blyck-Team, damit wir
unsere fehlenden internen Apps und Agents dauerhaft darauf betreiben und nach
4 Wochen Betrieb entscheiden können, ob daraus ein eigenes Open-Source-Projekt
wird.

- **Zweck:** dauerhaft intern nutzen, also stabil statt Wegwerf-Code
- **Erste Nutzer:** das blyck-Team (Dogfooding)
- **Entscheidung danach:** eigenes OSS-Projekt ja oder nein
- **Form:** Coolify hat kein Plugin-System. Der Layer läuft als eigene App neben
  Coolify und steuert es über REST-API und den nativen MCP-Server. Coolify
  bleibt unverändert (Apache 2.0, kein Fork).

## Definition of Done

v1 ist fertig, wenn alle sieben Kriterien nachweisbar erfüllt sind.

| # | Kriterium | Nachweis |
| --- | --- | --- |
| 1 | App aus dem Starter-Template per MCP-Befehl in Claude Code anlegen und live deployen, in unter 15 Min, ohne die Coolify-Oberfläche anzufassen | Durchlauf mit Stoppuhr |
| 2 | Jede App liegt hinter dem gemeinsamen Login (Better Auth, Google-SSO). Ohne Login kommt man nicht rein, auch nach einem Coolify-Update | Testskript ruft alle App-Domains ohne Session auf, vor und nach Update |
| 3 | Standard: jede App hat eigenes Schema und eigene DB-Rolle, App A sieht nichts von App B. Nach Freigabe in der Control Plane liest A die freigegebenen Tabellen/Views von B. Widerruf wirkt sofort | Automatisierter Test: blockiert, Freigabe, lesbar, Widerruf, wieder blockiert |
| 4 | Deploy nur nach Review-Gate (gitleaks, Semgrep, Claude-Report). Ein absichtlich eingebautes Secret wird blockiert | Test-Repo |
| 5 | Rollback auf die Vorversion mit einem Befehl, in unter 2 Min | Demo |
| 6 | Ein Agent mit eigener Identität ruft über den Plattform-MCP Tools einer App auf. Er sieht und nutzt nur freigegebene Tools, ohne Freigabe wird er blockiert, jeder Aufruf wird protokolliert | Test mit zwei Agents (mit und ohne Freigabe) plus Log-Eintrag |
| 7 | Ein frischer Claude-Code-Agent baut nur mit `AGENTS.md`, Skill und Plattform-MCP eine einfache App (z. B. eine Projektliste) und deployt sie, ohne dass ein Mensch Code anfasst | Testlauf mit Protokoll, Review-Gate beim ersten oder zweiten Versuch grün |

## OSS-Entscheidung nach 4 Wochen Betrieb

Die Schwellen stehen vorab fest, damit das Ergebnis nicht im Nachhinein
schöngeredet wird.

- **Klares Ja:** mindestens 3 interne Apps werden im Alltag genutzt, der Betrieb
  kostet höchstens 2 h pro Woche, und das Setup auf einer frischen
  Coolify-Instanz ist in höchstens 30 Min reproduzierbar.
- **Klares Nein:** weniger als 2 Apps im Alltag genutzt, oder Login- und
  Update-Probleme fressen regelmäßig Zeit.
- **Dazwischen:** weiter intern nutzen, Entscheidung nach weiteren 4 Wochen.

## Kleinster Schnitt und Nicht-Ziele

v1 enthält nur, was die Kriterien brauchen.

**Drin in v1:**

- Control Plane (Next.js, Postgres, Better Auth) auf eurem eigenen Coolify, ein
  Coolify-Team
- Plattform-MCP mit `create_app`, `request_deploy`, `list_apps`, `rollback`,
  `grant`, `revoke`
- Ein Starter-Template: Next.js mit Login über Header, DB-Client und
  OpenAPI-Spec
- Traefik-Forward-Auth vor jeder App, Default-Deny
- Schema und DB-Rolle pro App, Freigaben zwischen Apps als Grants oder Views
- Review-Gate vor jedem Deploy
- MCP-Tools pro App, automatisch aus der OpenAPI-Spec erzeugt; Agents melden
  sich als eigener OAuth-Client an
- Dünne Adapter-Schicht zu Coolify, damit das Backend austauschbar bleibt
- Manifest-Format und Quellen-Abstraktion für den späteren Katalog
- Design System als Paket, UI-Guide für Agents, UI-Prüfung im Review-Gate

**Nicht-Ziele in v1:**

- Managed-Hosting auf Hetzner und Mandantentrennung
- Freigabe-Gate für einzelne Agent-Aktionen, Pseudonymisierung, Oberfläche für
  Agent-Policies (v2, idealerweise aus den Agenten-Leitplanken von blyck)
- Öffentlicher Online-Katalog, Onboarding-Flow und UI-Politur (Manifest-Format
  und Katalog-Quellen sind in v1 drin)
- Enterprise-SSO/SCIM und Bezahlfunktionen

## Timebox, Abbruch, Risiko zuerst

v1 ist auf 6–8 Wochen angesetzt, die riskantesten Teile kommen zuerst.

| Wann | Was | Abbruch-Kriterium |
| --- | --- | --- |
| Tag 0 | marmelab/platform 1 Tag testen: Fork als Basis oder Neubau? | – |
| Woche 1 | Forward-Auth über Traefik-Labels plus Default-Deny, robust gegen Coolify-Updates | Steht nach Woche 1 nicht stabil: Ansatz neu denken |
| Woche 2 | Schema pro App, Freigaben zwischen Apps, Rechtemodell | – |
| Woche 3 | Automatisch erzeugte MCP-Tools pro App, Agent-Login | Laufen nicht sauber: auf handgeschriebene Tools pro Template ausweichen |
| Woche 4–6 | Review-Gate, Rollback, Plattform-MCP, Starter-Template | – |
| Woche 6–8 | Puffer, erste echte interne Apps live | – |

**Größte Annahme:** Die Auth über manuelle Traefik-Labels bleibt bei
Coolify-Updates stabil. Kippt sie, sind Apps ungeschützt erreichbar. Deshalb
kommt sie in Woche 1 und bekommt eigene Regressionstests.

**Weitere Risiken:** Coolify hat keine harte Mandantentrennung (relevant erst
für Managed). Ein Claude-Review ist kein Sicherheitsbeweis, deshalb immer
zusammen mit deterministischen Scannern. Mit KI gebaute Apps können Konventionen
umgehen, deshalb DB-Rollen ohne `BYPASSRLS` und Netzwerkzugang nur über das
Gateway.

## Open-Core-Schnitt (Vorschlag)

Frei ist alles, was ein Team zum Bauen und Betreiben braucht. Bezahlt ist die
Governance, für die die IT zahlt, plus der Betrieb. Die Lizenz ist noch offen;
AGPL würde verhindern, dass ein Hoster den Layer einfach als eigenes Angebot
übernimmt.

| Baustein | Frei | Bezahlt |
| --- | --- | --- |
| Control Plane, Plattform-MCP, Starter-Templates | ✓ | |
| Gemeinsamer Login über Gateway (Google-SSO) | ✓ | |
| Schema pro App, Freigaben zwischen Apps, Rechtemodell | ✓ | |
| Agent-Zugang per MCP mit Rechten pro App und Tool | ✓ | |
| Review-Gate mit eigenem LLM-Key, Rollback | ✓ | |
| Enterprise-SSO und SCIM (Entra, Okta) | | ✓ |
| Freigabe-Gates für Agent-Aktionen, Pseudonymisierung | | ✓ |
| Audit-Log mit Export und Aufbewahrung | | ✓ |
| Zentrale IT-Policies und Freigabe-Workflows | | ✓ |
| Managed-Betrieb auf Hetzner mit SLA, Support | | ✓ |

**Verhältnis zu blyck:** blyck bleibt kommerziell. Der Layer kann als
Verbreitungskanal dienen; die bezahlten Agent-Leitplanken können aus blyck
kommen.
