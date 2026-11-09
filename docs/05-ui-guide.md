# UI-Guide

Entscheidung für v1: **Weg A — App-Shell plus Design System.** Geprüft wurden
alle drei Wege, siehe [`decisions/0002-ui-weg-a.md`](decisions/0002-ui-weg-a.md).

Apps sollen sich wie ein Produkt anfühlen, nicht wie zwanzig einzelne Tools.
Einheitlich wird die UI nicht durch Geschmack, sondern durch drei Dinge:

1. **Design System als Paket** — Tokens (Farben, Abstände, Schrift) und fertige
   Komponenten auf Basis von shadcn/ui, dazu Muster für Liste mit Filter,
   Formular, Detailansicht, leerer Zustand, Fehlerzustand. Das
   Starter-Template bindet das Paket ein.
2. **UI-Guide für Agents** — die Regeln unten, in `AGENTS.md` und im
   Build-Skill, dazu Beispiel-Screens zum Abschauen.
3. **Prüfung im Review-Gate** — ein Linter blockiert eigene Farbwerte und fremde
   UI-Bibliotheken. Zusätzlich macht Claude einen Screenshot der App und prüft
   ihn gegen diesen Guide.

## Die Regeln

| Regel | Prüft der Linter |
| --- | --- |
| Nur Komponenten aus `@openapps/ui` | ja |
| Keine eigenen Farbwerte (kein Hex, kein `rgb()`, keine Tailwind-Farbklasse außerhalb der Tokens) | ja |
| Keine zweite UI-Bibliothek | ja |
| Jede Liste hat leeren und Fehlerzustand | ja (Muster-Import erforderlich) |
| Jedes Formular zeigt Validierungsfehler sichtbar am Feld | teilweise |
| Kontrast mindestens WCAG AA | Screenshot-Prüfung |
| Tastaturbedienung und sichtbarer Fokus | Screenshot-Prüfung |
| Dunkel und hell gleichwertig | Screenshot-Prüfung |
| Phone-Breite ohne waagerechtes Scrollen | Screenshot-Prüfung |

Eine Regel, die der Linter nicht prüfen kann und die auch kein Screenshot
belegt, ist eine Bitte und gehört nicht in diese Tabelle.

## Die Shell

Die Plattform liefert Navigation, App-Wechsler, Login, Profil und
Benachrichtigungen. Apps bauen nur ihren Inhalt. Die Schwäche von Weg A ist,
dass die Shell stabil und gut gemacht sein muss — deshalb hat sie eigene Tests
und wird nicht von App-Agents geändert.
