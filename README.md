# openapps

Ein schlanker App-Layer **neben** Coolify. Er steuert Coolify über REST-API und
MCP, lässt Coolify selbst unverändert (Apache 2.0, kein Fork) und gibt internen
Apps und Agents eine gemeinsame Basis: ein Login, ein Rechtemodell, ein
Review-Gate, ein Design System.

> Status: **v1 im Bau.** Erst intern bei blyck im Einsatz (Dogfooding), danach
> die Entscheidung über ein eigenes Open-Source-Projekt. Siehe
> [`docs/00-brief.md`](docs/00-brief.md).

## Agents first

Jede Funktion gibt es zuerst als API und MCP-Tool, die Oberfläche kommt danach
und nutzt dieselbe API. Was ein Mensch in der UI kann, kann ein Agent über MCP —
mit denselben Rechten aus demselben Rechtemodell.

## Aufbau

| Pfad                    | Was                                                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `apps/control-plane`    | Die einzige eigene Laufzeit-App: Apps anlegen, deployen, freigeben, zurücksetzen (Next.js, Postgres, Better Auth) |
| `apps/platform-mcp`     | Plattform-MCP unter `/mcp`: Apps, Deploys, Freigaben, Gruppen, Agent-Identitäten (15 Tools)                       |
| `packages/app-manifest` | Schema und Typen für `app.json` (Manifest + Katalog-Quellen)                                                      |
| `packages/ui`           | Design System: Tokens, Komponenten, Muster (Liste, Formular, Detail, leer, Fehler)                                |
| `packages/sdk`          | Client für Apps: Nutzer aus Headern, DB-Client auf eigenem Schema                                                 |
| `templates/starter-app` | Starter-Template für neue Apps (OpenAPI zuerst, dann Screens)                                                     |
| `infra/`                | Traefik-Forward-Auth, Postgres-Rollen, Betriebs-Skripte                                                           |
| `docs/`                 | Brief, Architektur, Roadmap, DoD, Entscheidungen                                                                  |

## Lokal ausprobieren, mit Standard-Apps und Agents

`infra/lokal/` startet die ganze Plattform in Docker, ohne Coolify und ohne
GitHub. Dazu kommen drei Standard-Apps aus `standard-apps/`: `wiki` (Seiten wie
in Notion), `crm` und `wissen` (Dokumente mit Passagensuche, die
Retrieval-Hälfte eines RAG). Anleitung: [`infra/lokal/README.md`](infra/lokal/README.md).
Was echte Agents damit gemacht haben, steht in
[`docs/nachweise/lokal-agents.md`](docs/nachweise/lokal-agents.md).

## Apps mit dem eigenen Assistenten bauen

Apps baut und ändert dein eigener Claude Code, verbunden mit dem
Plattform-MCP. Das Plugin [`plugins/openapps`](plugins/openapps/README.md)
bringt drei Dinge mit:

- die Verbindung zum MCP, mit Adresse und Token aus der Umgebung;
- die Regeln der Plattform als Skill;
- die Befehle `/openapps:neue-app`, `/openapps:app-aendern` und
  `/openapps:status`.

Installieren in Claude Code:

```text
/plugin marketplace add jonasqz/openapps
/plugin install openapps@openapps
```

Wie man sich verbindet, steht in der Verwaltung unter „Loslegen“. Für
Assistenten ohne Browser steht dasselbe im MCP-Prompt `loslegen`.

## Auf einen Server bringen

Ein Server mit Coolify, eine Compose-Datei, eine Liste von Variablen:
[`infra/betrieb/README.md`](infra/betrieb/README.md). Wohin das Projekt will,
steht in [`docs/08-zielbild.md`](docs/08-zielbild.md).

## Loslegen

```bash
pnpm install
pnpm check
```

## Mitarbeiten

- Regeln für Agents, die Apps für diese Plattform bauen: [`AGENTS.md`](AGENTS.md)
- Regeln für Arbeit **an** diesem Repo: [`CLAUDE.md`](CLAUDE.md)
- Lizenz: noch offen, siehe [`docs/06-lizenz.md`](docs/06-lizenz.md)
