# ADR 0018: Bedienung wie ein Werkzeug: Palette, Seitenkopf, Tabellen mit Suche

Stand: 25.11.2026

## Kontext

ADR 0010 hat dem Design System ein eigenes Gesicht gegeben. Die Bedienung
blieb dabei roh, wie die lokal laufende Control Plane zeigt:

- Jede Seite baut ihren Kopf selbst, mit fettem Sans-Titel statt der
  Display-Serife.
- Die Navigation hat keine Icons und keinen Tastaturweg.
- Lange Listen wie die Freigaben haben weder Suche noch Filter.
- Abgeschnittene Kennungen (`agent:e2e-writer-mwvi…`) zeigen den vollen Wert
  nirgends.
- Ein Widerruf passiert ohne Rückfrage und lässt sich nicht zurücknehmen.

Für ein Admin-Werkzeug, das Menschen und Agents täglich bedienen, wirkt das
unfertig.

## Entscheidung

1. **Neue Bausteine in `@openapps/ui`, nur additiv.** Keine bestehende Prop
   ändert sich.
   - `PageHeader`: Pfad oder Eyebrow, Serifentitel, Beschreibung, Aktionen,
     darunter eine Haarlinie. Genau eine `h1` pro Seite.
   - `Stat` und `StatGroup`: Kennzahlen im Haarlinien-Raster, wahlweise als
     Link auf die gefilterte Liste.
   - `Icon`: ein eigener Satz Linien-Icons, serverfähig über `name`. Keine
     Icon-Bibliothek, der UI-Linter bleibt streng.
   - `Kbd` und `Skeleton`.
   - `CommandPalette` mit `filterCommands`.
2. **⌘K / Strg+K in jeder `AppShell`.** Die Palette listet alle Einträge der
   Navigation und alle Apps. Sie ist eine Combobox mit Listbox: Der Fokus
   bleibt im Feld, Pfeiltasten wählen, Enter öffnet, Escape schließt. Oben in
   der Sidebar steht ein Suchknopf. Abschalten geht mit
   `commandPalette={false}`. Der Fokus-Reihenfolge-Test der Shell bleibt
   unverändert, weil der Knopf in der Sidebar steht, nicht in der Kopfzeile.
3. **`Table` bekommt `searchable` und `toolbar`.**
   - `searchable` filtert im Browser über alle Spalten mit `field` und zeigt
     „2 of 3“.
   - Gibt es keinen Treffer, erscheint ein eigener Zustand mit „Clear filter“.
     Er ist nicht dasselbe wie der Leer-Zustand.
   - Abgeschnittene Zellen tragen den vollen Wert als `title`.
   - `searchable` ist ein Boolean, also serverfähig.
   - Für große Listen bleibt die Suche auf dem Server (`ListPattern`).
4. **Die Control Plane nutzt das:** `PageHeader` statt eines eigenen Kopfs,
   Suche in den Tabellen für Apps, Agents und Freigaben.
5. **Der Klickdummy zeigt das Zielbild**, auf Englisch nach ADR 0016:
   - Übersichtsseite mit Kennzahlen, „Needs attention“ und letzter Aktivität.
   - Tabellen mit Suche, Filter und Sortierung (`aria-sort`).
   - Widerrufen, Sperren und Zurücksetzen nur nach Bestätigung, danach ein
     Toast mit „Undo“.
   - Ladezustand mit Skeletons.
   - Detailseiten mit einer Spalte für Eigenschaften.
   - Die Palette enthält dort auch Aktionen: App anlegen, Freigabe vergeben.

## Folgen

- Apps auf der `AppShell` bekommen ⌘K ohne eigenen Code. Wer selbst ⌘K
  belegt, schaltet die Palette ab.
- Die Bestätigung mit Undo steht bisher nur im Klickdummy. In der Control
  Plane gibt es noch keinen Widerruf in der Oberfläche. Kommt er, gilt das
  Muster: `Dialog` mit `role="alertdialog"`, danach ein Toast mit Aktion.
- **Nachtrag:** `Toast` hat dafür jetzt `action: { label, onClick }`. Ein
  Klick führt die Aktion aus und schließt die Meldung. Mit Aktion bleibt
  eine Meldung 10 s statt 6 s stehen, und die Zeit pausiert, solange Maus
  oder Fokus darauf liegen (WCAG 2.2.1). Die Aktion muss es auch als Tool
  geben. „Undo“ eines Widerrufs ist ein erneutes `grant`.
- Die Icons in der Navigation der Control Plane setzt die Session, die
  `(verwaltung)/shell.tsx` gerade umbaut (ADR 0017). Diese Datei ist hier
  bewusst unverändert.
- Gefunden beim Prüfen: Ein `sr-only`-Element in einem Scroll- oder
  Overflow-Container ohne `position: relative` entkommt dem Container. Auf
  Phone-Breite verbreitert es dann die Seite. `Table` hat deshalb
  `relative`.

## Alternativen

- **Eine Komponentenbibliothek für Palette und Tabellen:** Verworfen, weil
  CLAUDE.md fremde UI-Bibliotheken verbietet und der Linter sie blockt.
- **Suche nur auf dem Server:** Das ist richtig für große Listen und bleibt
  in `ListPattern`. Für die kleinen Verwaltungslisten wäre es ein Roundtrip
  pro Tastendruck ohne Nutzen.
- **Die Palette in der Kopfzeile statt in der Sidebar:** Das änderte die
  getestete Fokus-Reihenfolge der Shell und kostete auf Phone-Breite Platz.
  Auf dem Telefon öffnet sie über die Schublade.
