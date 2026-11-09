# ADR 0003: `marmelab/platform` als Basis oder Neubau?

Stand 2026-11-09 · Status: **offen** — Entscheidungsvorlage für Tag 0

Dies ist noch keine Entscheidung. Es ist die Vorlage, an der der Testtag aus
[`../02-roadmap.md`](../02-roadmap.md) gemessen wird. Das Feld „Entscheidung“
bleibt leer, bis der Test gelaufen ist.

## Kontext

Die Roadmap sieht Tag 0 vor: `marmelab/platform` einen Tag testen, dann
entscheiden — Fork als Basis oder Neubau. Die Frist ist ein Tag, nicht eine
Woche. Ohne vorab festgelegte Kriterien wird aus dem Test ein Gefühl.

### Was über `marmelab/platform` belastbar ist

Quelle: GitHub-API und Repo-Dateien, abgerufen am 2026-11-09.

| Punkt | Befund | Quelle |
| --- | --- | --- |
| Zweck | „Self-hosted hosting for Claude Code–built apps: a Supabase backend per app, deployed by asking Claude, on a single VM.“ | Repo-Beschreibung, `api.github.com/repos/marmelab/platform`, 2026-11-09 |
| Sprache, Lizenz | TypeScript; MIT, „except the vendored Studio in `apps/studio/`“ (Sustainable Use License) | API und `README.md`, 2026-11-09 |
| Alter, Verbreitung | angelegt 2026-10-02, letzter Push 2026-11-06, 14 Sterne | API, 2026-11-09 |
| Reifegrad | Alpha. Produktions-Blocker als P1 in `docs/TECH_DEBT.md`. Zentrale Logs „not yet done“. CI bisher nur gegen ein simuliertes GitHub getestet | `README.md`, 2026-11-09 |
| Reverse Proxy | **Caddy**, HTTPS und Routing nach Hostname, Zertifikate on demand für vom Control Plane freigegebene Hosts | `README.md`, 2026-11-09 |
| Control Plane | Hono-API, die MCP-Server, Deploy-API und Admin-API bedient und Caddy-Routen setzt | `README.md`, 2026-11-09 |
| Datenmodell | Ein Postgres, eine **Datenbank pro App**, plus Platform-DB. Pro App eigene GoTrue- und PostgREST-Instanz und eigenes JWT-Secret | `README.md` und `docs/ARCHITECTURE.md`, 2026-11-09 |
| Login | Pro App eigenes GoTrue. Plattform-SSO über OIDC gilt für Studio und Admin-Konsole; Apps können es als Provider dazunehmen | `docs/ARCHITECTURE.md`, 2026-11-09 |
| Forward-Auth | Nur vor dem Studio: „Studio on `<domain>` itself behind the control plane's forward auth“. Für App-Frontends beschreibt das Dokument keine Prüfung am Proxy; sie sind statische Dateien, die Caddy ausliefert | `docs/ARCHITECTURE.md`, 2026-11-09 |
| Review-Gate | Teilweise: Die eigenen Checks der Organisation laufen in einem reusable Workflow („dependency analysis, secret scanning, SAST, etc.“). Die Plattform schreibt keine Liste vor und prüft die Code-Review-Regeln nicht | `docs/ARCHITECTURE.md`, 2026-11-09 |
| Rollback | Ja: „rollback to a version already deployed by CI“, Frontend über Symlink — „Rollback means repointing the symlink“ | `docs/ARCHITECTURE.md`, 2026-11-09 |
| Agent-Rechte | PATs mit Scopes und optionaler Begrenzung pro App; jedes Tool prüft „user → app rights“ | `docs/ARCHITECTURE.md`, 2026-11-09 |
| Freigaben zwischen Apps | Nicht beschrieben. Jede App hat ihre eigene Datenbank, Zugriff ist pro App begrenzt | `docs/ARCHITECTURE.md`, 2026-11-09 |
| Anforderungen | macOS oder Linux mit Docker, Docker Desktop ≥ 8 GB RAM, Node 24, pnpm 10, Deno 2 für Edge-Function-Tests; ca. 16 GB freier Host-RAM für den Studio-Build | `README.md`, 2026-11-09 |

### Was nicht belastbar ist

- **Keine Angabe zu Coolify.** Das Projekt setzt auf Caddy und eine eigene VM.
  Ob und wie es neben Coolify läuft, steht nirgends. Das ist nicht „passt
  nicht“, sondern „unbekannt“ und muss am Tag 0 ausprobiert werden.
- **Keine Aussage zur Nutzung außerhalb von Marmelab.** 14 Sterne und fünf
  Wochen Alter sagen nichts über Betriebserfahrung. Es gibt keine Quelle zu
  Nutzern, Issues-Durchlauf oder Release-Rhythmus, die wir geprüft hätten.
- **Keine geprüfte Aussage zur Qualität des Codes.** Nicht gelesen.
- **Keine Aussage zu Lizenz-Verträglichkeit mit unserem Open-Core-Schnitt.**
  MIT ist verträglich, aber das vendored Studio unter Sustainable Use License
  ist ein eigener Punkt und wurde nicht geprüft. `docs/06-lizenz.md` hält die
  Lizenzfrage ohnehin offen.
- Eine Websuche nach dem Projekt lieferte nichts Verwertbares. Die Befunde
  oben stammen ausschließlich aus dem Repo selbst.

## Die Kriterien für den Tag 0

Gemessen wird daran, ob die sieben DoD-Kriterien aus
[`../03-dod.md`](../03-dod.md) erreichbar bleiben — nicht daran, ob der Code
gefällt. Jede Zeile bekommt `ja`, `nein` oder `unklar`. Beobachtung, nicht
Einschätzung: Was nicht am Tag 0 lief, ist `unklar`.

| # | Frage am Projekt | DoD | Erfüllt, wenn |
| --- | --- | --- | --- |
| K1 | Läuft es neben unserem Coolify, oder ersetzt es es? | alle | Es lässt sich ohne Umbau von Coolify installieren, oder der Konflikt ist benannt und begrenzt |
| K2 | Lässt sich Default-Deny vor **App-Domains** einbauen, nicht nur vor dem Studio? | 2 | Ein Eingriffspunkt im Proxy-Pfad ist gefunden, an dem jede App-Domain ohne Session gesperrt wird |
| K3 | Lässt sich der Proxy auf Traefik oder auf unser Gateway umstellen, oder akzeptieren wir Caddy? | 2 | Einer der drei Wege ist gangbar und beziffert |
| K4 | Lassen sich Freigaben zwischen Apps nachrüsten, obwohl jede App eine eigene Datenbank hat? | 3 | Ein Weg für Lesefreigaben über Datenbankgrenzen ist gefunden, oder der Umbau auf Schema pro App ist beziffert |
| K5 | Lässt sich das Review-Gate verbindlich machen, nicht optional? | 4 | Es gibt einen Punkt, an dem ein Deploy ohne grüne Scanner nicht stattfindet |
| K6 | Reicht der vorhandene Rollback für „ein Befehl, unter 2 Min“? | 5 | Ein Rollback wurde am Tag 0 ausgeführt und gemessen |
| K7 | Tragen PATs mit Scopes unser Agent-Modell, inklusive Protokoll pro Aufruf? | 6 | Rechte pro Tool und ein Log-Eintrag pro Aufruf sind vorhanden oder klein nachrüstbar |
| K8 | Bleibt `AGENTS.md` Regel 1 gültig — Apps ohne Login-Code? | 2, 7 | Ja, oder die nötige Änderung an Regel 1 ist benannt |
| K9 | Reicht ein Setup auf frischer Instanz in 30 Min? | OSS-Schwelle | Das Setup lief am Tag 0 durch und wurde gemessen |
| K10 | Ist der Alpha-Stand tragbar für dauerhaften internen Betrieb? | Zweck | Die P1-Einträge aus `docs/TECH_DEBT.md` sind gelesen und keiner trifft unsere sieben Kriterien |

Regel für den Tag: Mehr als drei `nein` bei K1 bis K8 heißt Neubau. Mehr als
vier `unklar` heißt ebenfalls Neubau — ein Tag Timebox wird nicht verlängert,
um Unklarheit aufzulösen.

## Alternativen

### A: Fork als Basis

- **Gewinnt:** Deploy-Pfad, Studio, Releases und Rollback sind vorhanden. MIT
  erlaubt den Fork.
- **Kostet:** Wir tragen die Pflege eines Alpha-Projekts mit. Jeder Upstream-
  Release muss gemergt oder bewusst liegengelassen werden. Das ist genau die
  Last, die [`0001-layer-neben-coolify.md`](0001-layer-neben-coolify.md) für
  Coolify abgelehnt hat.
- **Kostet an Prinzipien:** Das Projekt setzt Supabase und eine Datenbank pro
  App. Unser Modell ist Schema plus Rolle pro App in einem Postgres, damit
  Freigaben zwischen Apps möglich sind (DoD 3). Das ist ein Umbau am Kern,
  nicht eine Anpassung.
- **Risiko:** Caddy statt Traefik heißt, die größte Annahme des Projekts wird
  neu gestellt, und die Spec aus
  [`../specs/woche-1-forward-auth.md`](../specs/woche-1-forward-auth.md)
  gilt nicht mehr unverändert.

### B: Neubau neben Coolify, wie in ADR 0001 beschlossen

- **Gewinnt:** Keine Fremdpflege. Das Datenmodell passt von Anfang an zu DoD 3.
  Traefik und Coolify bleiben, die Woche-1-Spec gilt.
- **Kostet:** Deploy, Releases und Rollback bauen wir selbst, wenn auch über
  die Coolify-API statt von Null.
- **Risiko:** Die Zeit in Woche 4–6 ist knapp bemessen.

### C: Kein Fork, aber gezielt abschauen

- **Gewinnt:** Lösungen für Routen-Verwaltung, Release-Begriff und
  Symlink-Rollback sind lesbar und MIT-lizenziert.
- **Kostet:** Jede übernommene Stelle braucht einen Lizenzhinweis und eine
  eigene Prüfung. Kein Upstream, keine Fehlerbehebungen von außen.
- **Risiko:** gering.

### Verworfen vor dem Test

- **Beides parallel aufsetzen und nach zwei Wochen entscheiden.** Verworfen:
  Die Frist ist ein Tag. Ein Parallelbetrieb verschiebt das Risiko von Woche 1
  nach hinten, und genau das soll die Risiko-Reihenfolge verhindern.

## Entscheidung

*(leer — wird am Tag 0 eingetragen)*

| Feld | Wert |
| --- | --- |
| Datum des Tests | |
| Wer | |
| Commit von `marmelab/platform` im Test | |
| K1 bis K10, Ergebnis | |
| Entscheidung | A / B / C |
| Begründung am Kriterium | |

## Folgen

*(leer — folgt aus der Entscheidung)*
