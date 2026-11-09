# Nachweis DoD 4: Deploy nur nach Review-Gate

**Kriterium:** Deploy nur nach Review-Gate (gitleaks, Semgrep, Claude-Report).
Ein absichtlich eingebautes Secret wird blockiert.

**Art:** Test im Code, plus ein Test-Repo, das im Projekt bleibt.

## Der Nachweis ist

`apps/control-plane/tests/review-gate.spec.ts` gegen ein Test-Repo mit einem
absichtlich eingebauten Secret. Das Repo bleibt im Projekt, damit der Test
wiederholbar ist (`docs/03-dod.md`, Regeln für Nachweise).

Der Test deckt beide Richtungen ab: das Repo mit Secret wird blockiert, ein
sauberes Repo kommt durch. Ein Gate, das alles blockiert, ist kein Gate.

Stand: offen — Test existiert noch nicht.

## Was der Test beweist

- `gitleaks` findet das eingebaute Secret, und der Befund blockiert den Deploy,
  nicht nur die Protokollzeile.
- Der Deploy-Pfad ist ohne grünes Gate nicht erreichbar: `request_deploy`
  bricht ab, bevor der Coolify-Adapter aufgerufen wird.
- Die deterministischen Scanner laufen mit, unabhängig vom Claude-Review.
- Ein sauberes Repo kommt durch.

## Was der Test nicht beweist

- **Nicht**, dass der Code sicher ist. Ein grünes Gate heißt: diese Scanner
  haben nichts gefunden. `docs/00-brief.md` sagt es deutlich — ein
  Claude-Review ist kein Sicherheitsbeweis.
- **Nicht**, dass andere Secret-Formen gefunden werden. Der Test kennt genau
  das eine eingebaute Secret. Ein Secret in einem Format, das die Regelmenge
  nicht abdeckt, bleibt unentdeckt.
- **Nicht**, dass das Claude-Review verlässlich urteilt. Es ist nicht
  deterministisch und kann in zwei Läufen zwei Ergebnisse liefern. Deshalb
  hängt das Blockieren im Test an den Scannern, nicht am Review.
- **Nicht**, dass das Gate nicht umgangen werden kann. Ein Deploy direkt über
  die Coolify-Oberfläche oder die Coolify-API umgeht es. Dass das ausgeschlossen
  ist, ist eine Betriebsfrage und kein Ergebnis dieses Tests.
