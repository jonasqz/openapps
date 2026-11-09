# Nachweis DoD 7: Frischer Agent baut und deployt eine App

**Kriterium:** Ein frischer Claude-Code-Agent baut nur mit `AGENTS.md`, Skill
und Plattform-MCP eine einfache App (z. B. eine Projektliste) und deployt sie,
ohne dass ein Mensch Code anfasst. Review-Gate beim ersten oder zweiten Versuch
grün.

**Art:** Testlauf mit Protokoll. Vorlage unten kopieren.

---

## Lauf vom `<JJJJ-MM-TT>`

| Feld | Wert |
| --- | --- |
| Datum, Uhrzeit | |
| Wer hat den Lauf gestartet | |
| Modell und Claude-Code-Version | |
| Frischer Kontext? (kein Vorwissen aus diesem Projekt) | ja / nein |
| Verfügbar: `AGENTS.md`, Skill, Plattform-MCP | |
| Weitere Hilfen (müssen leer sein) | |
| Aufgabenstellung (wortgetreu) | |
| Transkript liegt in | |

### Ablauf

| # | Was der Agent tat | Versuch | Ergebnis |
| --- | --- | --- | --- |
| 1 | `list_apps` | | |
| 2 | `create_app` | | |
| 3 | App gebaut, gepusht | | |
| 4 | `request_deploy`, Versuch 1 | 1 | grün / rot |
| 5 | Falls rot: Befunde und Nachbesserung | 2 | grün / rot |
| 6 | Deploy, Domain antwortet | | |

### Menscheneingriff

Jeder Eingriff zählt. Auch ein Hinweis im Chat.

| # | Art des Eingriffs | Warum | Code angefasst? |
| --- | --- | --- | --- |
| | | | |

### Messung

| Feld | Wert |
| --- | --- |
| Versuche bis Review-Gate grün | |
| Schwelle | höchstens 2 |
| Mensch hat Code angefasst | ja / nein (ja = nicht erfüllt) |
| Gesamtdauer | |
| Blockierende Befunde im Gate (welche Regel) | |

### Ergebnis

- Ergebnis: `erfüllt` / `nicht erfüllt` / `teilweise`
- Begründung in einem Satz:

### Abweichungen

| # | Was | Folge für `AGENTS.md` oder den Skill |
| --- | --- | --- |
| | | |

### Was dieser Lauf nicht zeigt

- Nicht, dass jede App so entsteht. Ein Lauf mit einer Projektliste belegt
  nicht die schwierigen Fälle.
- Nicht, dass die App sicher ist. Das Review-Gate ist der Nachweis dafür
  (DoD 4), nicht dieser Lauf.
- Nicht, dass `AGENTS.md` vollständig ist. Jede Nachfrage des Agents ist eine
  Lücke und gehört in die Abweichungen.
