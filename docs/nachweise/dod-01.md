# Nachweis DoD 1: App anlegen und live deployen

**Kriterium:** App aus dem Starter-Template per MCP-Befehl in Claude Code
anlegen und live deployen, in unter 15 Min, ohne die Coolify-Oberfläche
anzufassen.

**Art:** Protokoll mit Stoppuhr. Vorlage unten kopieren, nicht überschreiben.

---

## Lauf vom `<JJJJ-MM-TT>`

| Feld | Wert |
| --- | --- |
| Datum, Uhrzeit | |
| Wer | |
| Coolify-Version | |
| Control-Plane-Version (Commit) | |
| Starter-Template-Version (Commit) | |
| Host / Umgebung | |
| Claude-Code-Version | |
| App-Name im Lauf | |

### Schritte

Zeit pro Schritt eintragen, Stoppuhr läuft durch.

| # | Schritt | Start | Ende | Bemerkung |
| --- | --- | --- | --- | --- |
| 1 | `list_apps` — Name noch frei? | | | |
| 2 | `create_app` — Repo aus Template | | | |
| 3 | Repo geklont, erster Commit gepusht | | | |
| 4 | `request_deploy` — Scanner und Review | | | |
| 5 | Deploy durch Coolify, Container läuft | | | |
| 6 | Domain antwortet, Login greift | | | |

### Messung

| Feld | Wert |
| --- | --- |
| Gesamtzeit Schritt 1 bis 6 | |
| Schwelle | 15:00 min |
| Coolify-Oberfläche angefasst? | ja / nein |
| Manuelle Eingriffe außerhalb von MCP | |

### Ergebnis

- Ergebnis: `erfüllt` / `nicht erfüllt` / `teilweise`
- Begründung in einem Satz:

### Abweichungen

Jede Abweichung mit Schritt-Nummer. Auch wenn der Lauf grün war.

| # | Was | Folge |
| --- | --- | --- |
| | | |

### Was dieser Lauf nicht zeigt

- Nicht, dass ein zweiter Lauf auf einer frischen Coolify-Instanz genauso
  schnell ist. Das ist die 30-Min-Schwelle aus `../00-brief.md` und ein eigener
  Lauf.
- Nicht, dass die App fachlich etwas tut. Nur, dass sie live und geschützt ist.
