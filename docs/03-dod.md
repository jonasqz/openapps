# Definition of Done — Nachweis-Mappe

v1 ist fertig, wenn alle sieben Kriterien **nachweisbar** erfüllt sind. Jede
Zeile bekommt einen Nachweis im Repo, keinen Haken aus dem Gedächtnis.

| # | Kriterium | Nachweis | Liegt in | Stand |
| --- | --- | --- | --- | --- |
| 1 | App anlegen und live deployen per MCP, < 15 Min, ohne Coolify-UI | Durchlauf mit Stoppuhr | `docs/nachweise/dod-01.md` | offen |
| 2 | Jede App hinter gemeinsamem Login, auch nach Coolify-Update | Testskript gegen alle App-Domains ohne Session, vor und nach Update | `infra/scripts/check-auth.sh` | offen |
| 3 | Schema und DB-Rolle pro App, Freigabe und Widerruf wirken | Test: blockiert → Freigabe → lesbar → Widerruf → blockiert | `apps/control-plane/tests/grants.spec.ts` | offen |
| 4 | Deploy nur nach Review-Gate, eingebautes Secret wird blockiert | Test-Repo mit Secret | `apps/control-plane/tests/review-gate.spec.ts` | offen |
| 5 | Rollback mit einem Befehl, < 2 Min | Demo mit Mitschnitt | `docs/nachweise/dod-05.md` | offen |
| 6 | Agent nutzt nur freigegebene Tools, jeder Aufruf protokolliert | Zwei Agents (mit/ohne Freigabe) plus Log-Eintrag | `apps/platform-mcp/tests/agent-grants.spec.ts` | offen |
| 7 | Frischer Agent baut und deployt eine App ohne Menschen-Code | Testlauf mit Protokoll, Gate beim 1. oder 2. Versuch grün | `docs/nachweise/dod-07.md` | offen |

## Regeln für Nachweise

- Ein Nachweis ist automatisiert oder protokolliert. „Hat funktioniert“ zählt
  nicht.
- Kriterium 2 wird **zweimal** geprüft: vor und nach einem Coolify-Update. Das
  ist die größte Annahme des Projekts.
- Kriterium 4 braucht ein Test-Repo mit einem absichtlich eingebauten Secret.
  Das Repo bleibt im Projekt, damit der Test wiederholbar ist.
- Ein Claude-Review allein erfüllt Kriterium 4 nicht. Die deterministischen
  Scanner müssen mitlaufen.
