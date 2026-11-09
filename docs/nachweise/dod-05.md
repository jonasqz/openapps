# Nachweis DoD 5: Rollback mit einem Befehl

**Kriterium:** Rollback auf die Vorversion mit einem Befehl, in unter 2 Min.

**Art:** Protokoll mit Stoppuhr, plus Mitschnitt. Vorlage unten kopieren.

---

## Lauf vom `<JJJJ-MM-TT>`

| Feld | Wert |
| --- | --- |
| Datum, Uhrzeit | |
| Wer | |
| Coolify-Version | |
| Control-Plane-Version (Commit) | |
| App im Lauf | |
| Version vorher (Commit / Release) | |
| Version nachher (Commit / Release) | |
| Mitschnitt liegt in | |

### Vorbereitung

| # | Schritt | Erledigt |
| --- | --- | --- |
| 1 | Zwei Versionen der App sind deployt, beide waren live | |
| 2 | Die neue Version ist am Verhalten erkennbar (sichtbarer Unterschied) | |
| 3 | Rollback-Befehl ist der dokumentierte, kein Sonderweg | |

### Messung

| Feld | Wert |
| --- | --- |
| Befehl (wortgetreu) | |
| Start (Befehl abgesetzt) | |
| Ende (Vorversion antwortet auf der Domain) | |
| Dauer | |
| Schwelle | 2:00 min |
| Anzahl Befehle | (muss 1 sein) |
| Downtime während des Rollbacks | |

### Prüfung nach dem Rollback

| Prüfung | Ergebnis |
| --- | --- |
| Domain zeigt die Vorversion | |
| Login greift weiterhin (kurzer Aufruf ohne Session) | |
| DB-Schema und Rolle unverändert | |
| Rollback ist in der Control Plane protokolliert | |

### Ergebnis

- Ergebnis: `erfüllt` / `nicht erfüllt` / `teilweise`
- Begründung in einem Satz:

### Abweichungen

| # | Was | Folge |
| --- | --- | --- |
| | | |

### Was dieser Lauf nicht zeigt

- Nicht, dass ein Rollback mit Datenbank-Migration funktioniert. Eine
  rückwärts nicht kompatible Migration ist ein eigener Fall und in v1 nicht
  abgedeckt.
- Nicht, dass die Vorversion noch korrekt arbeitet, nur dass sie wieder läuft.
