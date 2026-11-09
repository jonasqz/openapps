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
| Jedes Formular zeigt Validierungsfehler sichtbar am Feld | ja (Muster-Import `FormPattern` erforderlich) |
| Keine Funktion aus einer serverseitig gerenderten Datei an `Table`, `ListPattern`, `DetailPattern`, `FormPattern` | ja (`no-server-function-props`) |
| Kontrast mindestens WCAG AA | Screenshot-Prüfung |
| Tastaturbedienung und sichtbarer Fokus | Screenshot-Prüfung |
| Dunkel und hell gleichwertig | Screenshot-Prüfung |
| Phone-Breite ohne waagerechtes Scrollen | Screenshot-Prüfung |

Eine Regel, die der Linter nicht prüfen kann und die auch kein Screenshot
belegt, ist eine Bitte und gehört nicht in diese Tabelle. Zwei Grenzen des
Linters stehen hier offen, weil sie statisch nicht zu schließen sind: Er prüft
den **Import** eines Musters, nicht das Verhalten zur Laufzeit — eine App kann
`EmptyState` importieren und nie rendern. Und ein Farbwert, der erst zur
Laufzeit in ein `style` wandert, wird nur erkannt, wenn er als ganze
Zeichenkette dasteht.

## Die Grenze zwischen Server und Browser

Das ist die erste Stelle, an der sich die Plattform-Vorgabe und das Design
System widersprechen konnten, und sie wird bei jeder weiteren interaktiven
Komponente wiederkommen.

`AGENTS.md` verlangt, dass eine Seite ihre Daten in der Server-Komponente holt.
`Table`, `Dialog`, `Tabs` und `Toast` brauchen Hooks, sind also
Client-Komponenten. **React reicht keine Funktion über diese Grenze** — eine
Tabelle, die `rowKey` oder `cell` als Funktion bekommt, bricht beim Build, nicht
erst im Browser. Gefunden wurde das beim ersten echten Build des
Starter-Templates; kein Test hatte es gezeigt, weil Tests im Browser laufen.

Deshalb:

- Eine Spalte nennt ihr **`field`**. `rowKey` entfällt, solange die Zeile ein
  Feld `id` hat. Die kürzeste schreibbare Tabelle ist damit zugleich die, die
  baut.
- Was eine Zelle zeigen soll, rechnet die Seite **vorher in die Zeile** — ein
  `toRow`-Mapping statt einer `cell`-Funktion.
- `cell`, `rowKey` als Funktion, `onRowActivate` und `back.onClick` bleiben
  erlaubt, aber nur in einer Datei mit `'use client'`.
- Ein Formular ist von Natur aus interaktiv. `FormPattern` verlangt `onSubmit`,
  gehört also immer in eine Client-Datei. Das ist keine Ausnahme, sondern die
  richtige Einordnung.

Der Linter (`no-server-function-props`) greift, wenn eine Datei sicher
serverseitig rendert: keine `'use client'`-Direktive, und entweder eine
App-Router-Seite oder eine `async`-Komponente. Zwei Fälle sieht er **nicht**,
und das steht hier, statt als Sicherheit verkauft zu werden: eine ausgelagerte
Komponente ohne `'use client'`, die von einer Server-Seite benutzt wird (ohne
Importgraph nicht entscheidbar), und Funktionen, die erst ein Aufruf
zurückgibt.

## Das Preset ersetzt Tailwinds Paletten

`@openapps/ui` gibt ein Tailwind-Preset aus, das Tailwinds eigene Paletten
**ersetzt** statt sie zu erweitern. `bg-blue-500` existiert damit gar nicht —
eine fremde Farbe ist nicht nur verboten, sie ist nicht erreichbar. Nebeneffekt:
Auch die Abstandsskala endet früher, `w-60` gibt es nicht. Layout-Breiten heißen
`w-nav`, `w-drawer`, `w-menu`, `w-panel`, `max-h-scroll`, `max-w-field`.

## Was eine App einbinden muss

```js
// next.config.js — das Paket wird als Quellcode ausgeliefert
transpilePackages: ['@openapps/ui']
```

```ts
// src/app/layout.tsx
import '@openapps/ui/tokens.css';
```

```js
// tailwind.config.js
import preset from '@openapps/ui/tailwind/preset.js';
export default { presets: [preset], content: ['./src/**/*.{ts,tsx}'] };
```

Die Shell bekommt den Nutzer als Prop: Die App holt ihn mit `getUser` aus
`@openapps/sdk` und reicht ihn als `user` herein. `null` heißt „noch nicht
geladen" — die Shell zeigt dann einen Platzhalter, nie ein Login-Formular.

## Die Shell

Die Plattform liefert Navigation, App-Wechsler, Login, Profil und
Benachrichtigungen. Apps bauen nur ihren Inhalt. Die Schwäche von Weg A ist,
dass die Shell stabil und gut gemacht sein muss — deshalb hat sie eigene Tests
und wird nicht von App-Agents geändert.
