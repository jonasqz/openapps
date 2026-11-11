# Zielbild

Stand 2026-11-11. Was openapps werden soll, wenn v1 trägt. Die Roadmap
([`02-roadmap.md`](02-roadmap.md)) sagt, was als Nächstes dran ist; diese Seite
sagt, wohin.

## In einem Satz

Eine Firma baut sich ihre eigenen Werkzeuge, mit jedem KI-Coding-Tool und
jedem Modell, und sie laufen sicher: ein Login, ein Rechtemodell, ein fester
Stack, dieselbe Art API für jede App. Menschen nutzen die Oberfläche, Agents
dieselben Funktionen über MCP.

## Was fest ist

| Baustein                        | Bedeutung                                                                                                                         |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Headless zuerst                 | Jede Aktion ist API und MCP-Tool, bevor sie einen Button bekommt. Die Oberfläche ist ein Client unter mehreren.                   |
| Ein Stack                       | Starter-Template, SDK, Design System. Agents bauen schneller und sicherer, wenn es nur einen Weg gibt.                            |
| Regeln, die eine Maschine prüft | Review-Gate vor jedem Deploy: gitleaks, semgrep, UI-Linter, Manifest-Abgleich. Immer an, in jeder Ausgabe.                        |
| Modell egal                     | Die Plattform ruft selbst kein Modell auf, außer im optionalen Review. Gebaut wird mit Claude Code, Codex, Cursor oder was kommt. |
| Open Source und selbst gehostet | Ein Compose-Stapel neben Coolify. Kein Fork.                                                                                      |

## Zwei Wege, ein Code

|                         | Selbst gehostet                                            | Managed                                                                        |
| ----------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Betrieb                 | eigener Server mit Coolify                                 | wir betreiben den Stapel                                                       |
| Regelbasierte Prüfungen | enthalten                                                  | enthalten                                                                      |
| KI-Sicherheitsreview    | mit eigenem Schlüssel (`ANTHROPIC_API_KEY`), ohne Aufpreis | eigener Schlüssel ohne Aufpreis, sonst pro Lauf: Tokenkosten plus kleine Marge |
| Code                    | derselbe                                                   | derselbe                                                                       |

Das KI-Review bleibt, was es heute ist: ein Bericht zusätzlich zu den
Scannern, nie an ihrer Stelle. Abrechnung pro Lauf braucht eine Zählung der
Tokens je Deployment im Audit-Log. Die gibt es noch nicht.

## Was dazukommt, in dieser Reihenfolge

1. **Erster echter Lauf bei blyck.** Der Stapel auf einem Server, eine erste
   App aus dem Starter, ein Agent, der sie über `/mcp` anlegt und deployt.
   Vorher ist alles Weitere Vermutung.
2. **Tool-Bibliothek.** Die Tools aller Apps an einer Stelle, auffindbar und
   pro Agent freigegeben. Die Weiterleitung steht im Plattform-MCP; es fehlen
   der Katalog als Seite und die Erzeugung aus der OpenAPI-Spec.
3. **Standard-Daten-API.** Jede App bekommt für ihre Tabellen dieselben
   Endpunkte (lesen, filtern, schreiben), aus dem Manifest erzeugt, mit den
   Rechten aus dem einen Modell. Das ist „APIs, die immer gleich
   funktionieren“.
4. **Konnektoren als Apps.** Google Workspace (Gmail, Kalender, Drive) und
   Microsoft 365 zuerst. Ein Konnektor ist eine gewöhnliche App mit Tools und
   Freigaben, kein Sonderweg. Die OAuth-Tokens der Nutzer liegen in der
   Control Plane, nie in der App.
5. **Gedächtnis als Add-on.** pgvector im selben Postgres, ein Schema pro App
   wie bisher, Suche als Tool. Kein zweiter Datenspeicher.
6. **OAuth für MCP.** Damit sich Clients ohne festen Header verbinden können
   (claude.ai als Connector). Heute geht jeder Client, der einen Bearer-Header
   setzt.
7. **Ein-Klick in Coolify.** Braucht fertige Images in einer Registry und
   einen Eintrag in Coolifys Dienstekatalog. Bis dahin: ein Repo, eine
   Compose-Datei, eine Liste von Variablen
   ([`infra/betrieb/`](../infra/betrieb/README.md)).

## Was es nicht wird

- Kein Ersatz für Coolify und kein eigenes PaaS.
- Kein Baukasten ohne Code. Apps sind Code in einem Repo, geprüft und
  versioniert.
- Kein Modell-Proxy. Schlüssel für Modelle gehören dem, der baut.
