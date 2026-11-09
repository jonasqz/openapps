# @openapps/platform-mcp

Der MCP-Server der Plattform. Er bietet die sechs Tools des Briefs an, liefert
`AGENTS.md` als Prompt aus und leitet die Tools der Apps weiter — jeweils nur
an Aufrufer, die eine Freigabe haben.

## Die Tools

| Tool             | Was es tut                                                                              |
| ---------------- | --------------------------------------------------------------------------------------- |
| `create_app`     | Repo aus dem Starter-Template anlegen, App registrieren, Schema und DB-Rolle einrichten |
| `request_deploy` | Review-Gate starten, bei Freigabe deployen                                              |
| `list_apps`      | Apps auflisten, auf die der Aufrufer `read` hat                                         |
| `rollback`       | zurück auf die Vorversion                                                               |
| `grant`          | eine Freigabe vergeben                                                                  |
| `revoke`         | eine Freigabe widerrufen                                                                |
| `list_grants`    | Freigaben nachsehen                                                                     |

Dazu kommen die App-Tools, benannt als `<app-name>.<tool>`. Angemeldet werden
nur die freigegebenen; aufgerufen werden dürfen auch nur die — der Aufruf prüft
ein zweites Mal, weil Ausblenden keine Durchsetzung ist.

## Prompt

`how_to_build_app` liefert den Inhalt von `AGENTS.md`, bei jedem Aufruf neu
gelesen. Damit haben Agents über MCP dieselben Regeln wie Agents in Claude Code
— eine Quelle, keine Kopie.

## Aufbau

```
src/tools.ts       die sechs Tools als Daten: Name, Schema, Handler
src/app-tools.ts   Sichtbarkeit und Aufruf der App-Tools
src/identity.ts    ein OAuth-Client pro Agent
src/invoker.ts     Weiterleitung an die App, durch das Gateway
src/server.ts      dünne Verdrahtung mit dem MCP-SDK
src/index.ts       Start über stdio
src/http.ts        Start über HTTP, Identität pro Aufruf
tests/             DoD 6
```

Die Tools enthalten keine eigene Logik und keine eigene Rechteprüfung: sie
rufen die Domänenfunktionen von `@openapps/control-plane`. Dadurch kann ein
Endpunkt nicht von seinem Tool abweichen. Das Manifest prüft
`appManifestSchema` aus `@openapps/app-manifest` — nicht ein zweites Schema.

Ein weitergeleiteter Aufruf trägt die Identität des Agents in denselben fünf
Headern wie ein Aufruf durch das Gateway, signiert mit dem Secret **dieser**
App (`identityHeadersForApp`). Der MCP kennt kein App-Secret: er leitet es aus
`OPENAPPS_AUTH_MASTER_SECRET` ab, genau wie die Forward-Auth.

## Starten

```bash
pnpm --filter @openapps/platform-mcp start        # stdio, für Claude Code
pnpm --filter @openapps/platform-mcp start:http   # HTTP, für Agents
pnpm --filter @openapps/platform-mcp test         # DoD-6-Test
```

Es gibt keinen Build-Schritt: der Server läuft über `tsx` aus der
TypeScript-Quelle, weil er die Domäne der Control Plane als Quelle einbindet.

## Nachweis

`tests/agent-grants.spec.ts` — DoD 6: zwei Agents (mit und ohne Freigabe),
Sichtbarkeit, Blockade, sofortige Wirkung des Widerrufs und je ein
Audit-Eintrag. Was einen echten Transport braucht, steht dort als `it.todo`.
