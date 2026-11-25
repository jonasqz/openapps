# ADR 0016: Produktsprache Englisch

Stand: 25.11.2026

## Kontext

Bisher war alles deutsch, was Menschen und Agents von openapps sehen:
Oberflächen, URLs wie `/loslegen` oder `/firmen/neu`, Beschreibungen der
MCP-Tools, Fehlermeldungen, Plugin-Befehle, Skill und README. Das Repo ist
öffentlich, und Agents bauen Apps nach dem, was sie vorfinden. So entstehen
deutsche Apps, auch wenn das Team gemischt ist.

## Entscheidung

- **Englisch ist die Produktsprache, ohne zweite Sprache.** Es gibt keine
  Übersetzungsschicht. Texte stehen direkt auf Englisch im Code.
- **Umgestellt wird alles, was Nutzer und Agents sehen:**
  - UI-Texte und `<html lang="en">`; Datumsformate mit `en-GB`.
  - URLs und Routen.
  - Beschreibungen von MCP-Tools und Prompts, Fehlermeldungen von API, SDK,
    Gateway und Review-Gate.
  - Plugin, Skill, `README.md`, `AGENTS.md` und die Ausgabe der lokalen
    Skripte.
- **Deutsch bleiben:** ADRs, `CLAUDE.md`, Code-Kommentare, Bezeichner,
  Dateinamen der Skripte und die übrigen Dokumente unter `docs/`. Sie richten
  sich an die Leute, die am Repo arbeiten.
- **Zwei Apps bekommen neue Namen**, weil ihr Name die URL ist: `wissen` wird
  `knowledge`, `aufgaben` wird `tasks`.

Die wichtigsten neuen Namen:

| vorher | jetzt |
|---|---|
| `/loslegen`, Prompt `loslegen` | `/get-started`, Prompt `get_started` |
| `/_lokal/als/admin`, `/_lokal/als/nutzer` | `/_local/as/admin`, `/_local/as/user` |
| Rolle `nutzer`, `nutzer@<domain>` | Rolle `user`, `user@<domain>` |
| `/openapps:neue-app`, `/openapps:app-aendern` | `/openapps:new-app`, `/openapps:change-app` |
| Skill `app-fuer-die-plattform-bauen` | Skill `build-platform-app` |
| CRM `/firmen`, `/kontakte`, `/aktivitaeten`, `…/neu` | `/companies`, `/contacts`, `/activities`, `…/new` |
| Wissen `/dokumente` | Knowledge `/documents` |
| Tool `aufgaben.erledigen` | `tasks.complete` |

## Folgen

- Wer die App `wissen` oder `aufgaben` lokal laufen hat, setzt den lokalen
  Stapel neu auf. Schema, DB-Rolle und Freigaben hängen am App-Namen.
  Auf einem Server war keine der beiden ausgerollt.
- Alte URLs werden nicht umgeleitet. Es gibt noch keine Nutzer, deren
  Lesezeichen brechen würden.
- Agents, die das Plugin schon installiert haben, aktualisieren es
  (`/plugin update openapps@openapps`), sonst fehlen die neuen Befehle.

## Alternativen

- **i18n mit Englisch und Deutsch:** Jede App müsste Texte als Schlüssel
  pflegen, und Agents müssten beide Sprachen schreiben. Für ein Team ohne
  Bedarf an zwei Sprachen zu viel. Verworfen, später nachrüstbar.
- **Nur die UI umstellen:** Dann stünden englische Seiten neben deutschen
  Tool-Beschreibungen, und Agents bauten weiter deutsch. Verworfen.
- **Auch ADRs und Kommentare übersetzen:** Viel Aufwand ohne Nutzen für die,
  die das Produkt verwenden. Verworfen.
