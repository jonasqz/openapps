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
| Nachweis-Mappe `docs/nachweise/` | ein Lauf liegt vor (Gateway, lokal, gegen Stub); die Läufe gegen echte Control Plane und echtes Coolify-Update stehen aus |
| Prüfskript DoD 2 | steht, prüft auch die Traefik-Konfiguration; noch kein Lauf gegen die Zielinstanz |
| Traefik-Konfiguration | steht: Entrypoint-Middleware, Catch-all-Router, Deny-Backend, Loopback-Entrypoint fürs 2-s-Timeout — acht Fälle lokal gegen Traefik 3.3.7 geprüft |
| Startup-Check gegen die Traefik-API | steht; unerreichbare API = WARN, falsche Antwort = ALARM, sichtbar in `/healthz` |
| Better Auth (Google-SSO) | steht: Domain-Schranke, Gruppen aus der Control Plane, Login-Seite ([ADR 0006](decisions/0006-gruppen-und-domain-schranke.md)) |

## Was als Nächstes dran ist

In dieser Reihenfolge, weil das Riskanteste zuerst kommt:

1. **Label-Lint ins Review-Gate verdrahten.** `missingForwardAuthLabels()`
   prüft inzwischen auch das Port-Label, wird aber von keinem Schritt
   aufgerufen. Spec 2 verlangt ihn vor und nach jedem Deploy — bis dahin ist er
   eine Funktion, die niemand ruft.
2. **DoD 2 auf der Zielinstanz nachweisen.** Der Gateway-Lauf lief lokal gegen
   einen Stub. Was fehlt: Lauf mit echter Control Plane, zwei Läufe um ein
   echtes Coolify-Update herum, und die Sekunden-Schleifen-Messung aus Spec 4.4.
   Das ist der Nachweis, auf den das ganze Projekt wartet.
3. **Tag 0 entscheiden**
   ([ADR 0003](decisions/0003-marmelab-platform-fork-oder-neubau.md)).
4. **Gruppenpflege als Endpunkt und MCP-Tool** (`grant_group_member`,
   `revoke_group_member`). „Agents first" verlangt sie, bevor es dafür eine
   Oberfläche gibt; bis dahin geht Pflege nur per SQL oder Bootstrap-Variable.
5. **Scanner wirklich laufen lassen** — gitleaks und semgrep als Prozess gegen
   ein Test-Repo mit eingebautem Secret (DoD 4).
6. **ADR 0005 umsetzen:** ein Vokabular für Subjekte.
7. **Die Control Plane in die App-Shell setzen.** Die Shell aus `@openapps/ui`
   steht, die Control Plane trägt sie noch nicht — die Login-Seite muss
   außerhalb liegen, das braucht eine Routengruppe.

## Bekannte Schulden

| Schuld | Warum sie jetzt in Kauf genommen ist |
| --- | --- |
| `platform-mcp` bindet die Domäne der Control Plane als TypeScript-Quelle ein und läuft über `tsx` | Der richtige Schnitt wäre ein eigenes Paket unter `packages/`. Das ist ein Umbau, der nichts an den Kriterien ändert — später, nicht jetzt. |
| Zwei Wörter für Subjekte (`user` in der Datenbank, `human` im Manifest), übersetzt an einer Stelle | [ADR 0005](decisions/0005-ein-vokabular-fuer-subjekte.md) entscheidet `human`; die Migration fehlt noch. |
| `better-auth` verlangt über `better-call` `zod` 4, im Repo liegt 3.24 | Bleibt eine Peer-Warnung: `better-auth` selbst hängt auf `zod@^3.24`. Dass es trägt, ist belegt — die Postgres-Tests laufen durch die echte Instanz. Ein Update von `better-call` kann es kippen; der kleine Hebel wäre ein Pin. |
| Forward-Auth läuft pro Aufruf zweimal: einmal am Entrypoint, einmal aus den App-Labels | Gürtel und Hosenträger, bis ein echtes Coolify-Update gemessen ist. Solange nicht bekannt ist, was ein Update mit den Labels tut, ist die zweite Schicht ihr Geld wert. Danach reduzieren. |
| Der Port einer App kommt aus einer `PORT`-Env-Konvention, nicht aus einem Manifest-Feld | Reicht heute. Ein eigenes Feld würde den Manifest-Abgleich im Review-Gate sauberer machen. |
| `@openapps/ui` liefert Quellcode, also müssen alle Apps dieselben React-Typen fahren (18) | Bewusst: lesbar für Agents, keine Stale-Build-Fehler. Preis ist die gemeinsame Typversion. |
| Test-Postgres läuft auf `postgres:16`, nicht 17 | Das Image lag lokal vor und die Nachweise sind dagegen **gelaufen**. Ein verifiziertes Image ist mehr wert als ein neueres, das nur vermutet ist. |
