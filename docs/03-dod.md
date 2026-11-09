# Definition of Done — Nachweis-Mappe

v1 ist fertig, wenn alle sieben Kriterien **nachweisbar** erfüllt sind. Jede
Zeile bekommt einen Nachweis im Repo, keinen Haken aus dem Gedächtnis.

| # | Kriterium | Nachweis | Liegt in | Stand |
| --- | --- | --- | --- | --- |
| 1 | App anlegen und live deployen per MCP, < 15 Min, ohne Coolify-UI | Durchlauf mit Stoppuhr | [`nachweise/dod-01.md`](nachweise/dod-01.md) | offen |
| 2 | Jede App hinter gemeinsamem Login, auch nach Coolify-Update | Testskript gegen alle App-Pfade ohne Session, vor und nach Update | `infra/scripts/check-auth.sh`, [`nachweise/dod-02.md`](nachweise/dod-02.md) | **offen**; zwei lokale Läufe gegen einen Stub liegen vor, einer davon mit einem Fehlschlag (verlorenes 2-s-Timeout). Kein Lauf gegen eine Zielinstanz, keiner um ein echtes Update |
| 3 | Schema und DB-Rolle pro App, Freigabe und Widerruf wirken | Test: blockiert → Freigabe → lesbar → Widerruf → blockiert | `apps/control-plane/tests/grants-postgres.spec.ts`, [`nachweise/dod-03.md`](nachweise/dod-03.md) | **gegen echtes Postgres grün**, offen bleibt der Lauf auf der Zielinstanz |
| 4 | Deploy nur nach Review-Gate, eingebautes Secret wird blockiert | Test-Repo mit Secret | `apps/control-plane/tests/review-gate.spec.ts`, [`nachweise/dod-04.md`](nachweise/dod-04.md) | offen |
| 5 | Rollback mit einem Befehl, < 2 Min | Demo mit Mitschnitt | [`nachweise/dod-05.md`](nachweise/dod-05.md) | offen |
| 6 | Agent nutzt nur freigegebene Tools, jeder Aufruf protokolliert | Zwei Agents (mit/ohne Freigabe) plus Log-Eintrag | `apps/platform-mcp/tests/agent-grants.spec.ts`, [`nachweise/dod-06.md`](nachweise/dod-06.md) | offen |
| 7 | Frischer Agent baut und deployt eine App ohne Menschen-Code | Testlauf mit Protokoll, Gate beim 1. oder 2. Versuch grün | [`nachweise/dod-07.md`](nachweise/dod-07.md) | offen |

Wie ein Nachweis geführt wird, steht in
[`nachweise/README.md`](nachweise/README.md).

## Regeln für Nachweise

- Ein Nachweis ist automatisiert oder protokolliert. „Hat funktioniert“ zählt
  nicht.
- Kriterium 2 wird **zweimal** geprüft: vor und nach einem Coolify-Update. Das
  ist die größte Annahme des Projekts. Seit ADR 0008 lautet sie nicht mehr
  „die Labels überleben“, sondern „Coolify fasst unsere Datei im dynamischen
  Verzeichnis nicht an" — belegt für v4.7.1, offen für jede spätere Fassung.
- Ein Lauf gegen einen Stub der Forward-Auth prüft das Gateway, nicht die
  Entscheidung. Für Kriterium 2 zählt am Ende nur ein Lauf gegen die echte
  Route.
- Kriterium 4 braucht ein Test-Repo mit einem absichtlich eingebauten Secret.
  Das Repo bleibt im Projekt, damit der Test wiederholbar ist.
- Ein Claude-Review allein erfüllt Kriterium 4 nicht. Die deterministischen
  Scanner müssen mitlaufen.
