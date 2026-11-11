# ADR 0009: Der Plattform-MCP läuft im Container der Control Plane, erreichbar unter `/mcp`

Stand 2026-11-11 · angenommen

## Kontext

„Agents first“ war bis hierher ein Versprechen im Code, kein Zugang: Der
Plattform-MCP existierte als Paket, aber kein Stapel startete ihn, kein Router
führte zu ihm, und es gab keinen Weg, einem Agenten eine Identität zu geben,
ohne in die Datenbank zu schreiben.

Der MCP braucht dieselbe Env, dieselbe Datenbank und denselben Mount für die
Traefik-Datei wie die Control Plane, weil ein `request_deploy` über MCP
dieselbe Domänenfunktion ruft wie der über die API. Und jeder Router, den wir
schreiben, trägt die Forward-Auth (ADR 0008). Die prüft Sessions von Menschen,
nicht Tokens von Agents.

## Entscheidung

1. **Ein Container, zwei Prozesse.** `start.sh` fährt die Migrationen, dann
   `next start` und den MCP. Endet einer, endet der Container, und der
   Neustart bringt beide zurück.
2. **Der MCP hört nur auf `127.0.0.1:3001`.** Von außen führt genau ein Weg zu
   ihm: die Route `/mcp` der Control Plane, die den Aufruf unverändert
   durchreicht. Es gibt keinen zweiten Router und keinen zweiten Host.
3. **`/mcp` steht in der Liste der Pfade ohne Session** (neben `/login`,
   `/api/auth/*`, `/healthz`), nur für den Host der Control Plane. Der MCP
   weist sich selbst aus: `Authorization: Bearer <clientId>.<secret>`, bei
   jedem Aufruf neu geprüft, gespeichert ist nur der sha256-Hash. Ohne
   gültiges Token antwortet er mit 401, bevor ein Tool läuft.
4. **Agent-Identitäten sind eine Ressource im einen Rechtemodell** (`agent`,
   Migration 0014/0015). Anlegen, auflisten und sperren gibt es als API, als
   MCP-Tool (`create_agent`, `list_agents`, `disable_agent`) und als Seite
   `/agents`. Das Token wird genau einmal angezeigt. Ein neuer Agent darf
   nichts, bis eine Freigabe ihn öffnet.
5. **Das Review-Gate holt den Code selbst.** `request_deploy` braucht keinen
   Pfad mehr: Die Control Plane lädt den Commit als Tarball vom Repo-Backend,
   prüft ihn und räumt ihn weg. Ein Agent auf einem fremden Rechner kann so
   deployen, ohne dass sein Dateisystem eine Rolle spielt.

## Folgen

- Ein Agent verbindet sich mit einer Zeile, etwa
  `claude mcp add --transport http openapps https://<CONTROL_PLANE_HOST>/mcp --header "Authorization: Bearer <token>"`.
  Jeder MCP-Client, der einen festen Header setzen kann, geht genauso.
- **`/mcp` ist ein Pfad, den die Forward-Auth durchlässt.** Das ist die zweite
  Stelle neben der Anmeldung, an der Default-Deny nicht am Gateway hängt,
  sondern am Dienst dahinter. Die Tests dazu stehen vorn: kein Token, falsches
  Token, gesperrter Agent, Agent ohne Freigabe.
- Ein Token läuft nicht ab. Sperren wirkt sofort, weil bei jedem Aufruf
  geprüft wird. OAuth für MCP (damit claude.ai als Connector ohne festen
  Header geht) fehlt und ist der nächste Schritt.
- Zwei Prozesse teilen sich Speicher und Schicksal. Auf einem kleinen Server
  ist das gewollt. Skalieren lassen sie sich so nicht getrennt.
- Der Tarball-Weg hängt am Repo-Backend: Der Token braucht Leserecht auf den
  Inhalt der App-Repos. Größe und Dauer sind begrenzt
  (`GITHUB_CHECKOUT_MAX_BYTES`, `GITHUB_CHECKOUT_TIMEOUT_MS`).

## Alternativen

- **Eigener Compose-Dienst für den MCP.** Sauberer getrennt, aber zweimal
  dieselbe Env und derselbe Mount in Coolify, also zwei Stellen, die
  auseinanderlaufen können. Später möglich, die Route `/mcp` bleibt dann
  gleich (`PLATFORM_MCP_URL`).
- **Eigener Traefik-Router ohne Forward-Auth.** Ein Router ohne Middleware ist
  genau das, was der Generator am Typ ausschließt (ADR 0008). Dafür keine
  Ausnahme.
- **MCP im Next-Prozess.** Spart den zweiten Prozess, koppelt aber den
  MCP-Transport an Next-Interna. Der Durchreicher ist 40 Zeilen und bleibt
  austauschbar.
- **`git clone` statt Tarball.** Braucht git im Image und Zugangsdaten im
  Dateisystem. Der Tarball braucht nur den Token, den die Control Plane
  ohnehin hat.
