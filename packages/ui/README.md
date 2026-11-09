# @openapps/ui

Das Design System von openapps: Tokens, Komponenten, Muster, App-Shell und der
UI-Linter. Entscheidung dahinter: [ADR 0002 — Weg A](../../docs/decisions/0002-ui-weg-a.md).

Eine App importiert **nur** aus diesem Paket. Keine zweite UI-Bibliothek, kein
eigener Farbwert. Der Linter blockiert beides.

## Einbinden

Das Paket wird **als Quellcode** ausgeliefert (`exports` zeigen auf `src/`) —
wie bei shadcn/ui. Next-Apps brauchen deshalb:

```js
// next.config.js
export default { transpilePackages: ['@openapps/ui'] };
```


```ts
// tailwind.config.js
import preset from '@openapps/ui/tailwind-preset';
export default { presets: [preset], content: ['./app/**/*.{ts,tsx}'] };
```

```ts
// app/layout.tsx
import '@openapps/ui/tokens.css';
```

```js
// eslint.config.js
import openappsUi from '@openapps/ui/eslint-config';
export default [...openappsUi];
```

```tsx
import { AppShell, ListPattern, Button } from '@openapps/ui';
```

## Was drin ist

| Teil | Export | Inhalt |
| --- | --- | --- |
| Tokens | `@openapps/ui/tokens`, `@openapps/ui/tokens.css` | Farben, Abstände, Größen, Schrift, Radien, Schatten, Z-Ebenen |
| Tailwind-Preset | `@openapps/ui/tailwind-preset` | ersetzt Tailwinds Paletten durch die Tokens |
| Komponenten | `@openapps/ui` | Button, Input, Select, Checkbox, Table, Dialog, Toast, Badge, Card, Tabs, Pagination, EmptyState, ErrorState, Spinner |
| Muster | `@openapps/ui` | ListPattern, FormPattern, DetailPattern, EmptyState, ErrorState |
| App-Shell | `@openapps/ui` | AppShell, AppSwitcher, UserMenu, NotificationBell |
| Texte | `@openapps/ui` | `strings`, `overrideStrings`, `germanStrings` |
| Linter | `@openapps/ui/eslint-config`, `@openapps/ui/lint/rules` | `no-raw-color`, `no-foreign-ui`, `require-list-states`, `require-form-states` |

## Tokens: eine Quelle

`src/tokens/tokens.ts` ist die **einzige** Quelle. Daraus werden erzeugt:

- `src/tokens/tokens.css` — CSS-Variablen auf `:root`, dunkel unter
  `@media (prefers-color-scheme: dark)` **und** `[data-theme="dark"]`, hell
  erzwingbar über `[data-theme="light"]`.
- `tailwind/preset.js` — dieselben Tokens als Tailwind-Theme.

```bash
pnpm --filter @openapps/ui tokens
```

Beide Dateien sind eingecheckt; `tokens.generated.test.ts` erzeugt sie im Test
neu und vergleicht — sie können also nicht auseinanderlaufen.

Weil das Preset Tailwinds Paletten **ersetzt**, gibt es `bg-blue-500` gar nicht.
Ebenso wenig `w-60`: die Abstandsskala endet bei `6rem`. Layout-Breiten heißen
`w-nav`, `w-drawer`, `w-menu`, `w-panel`, `max-h-scroll`, `max-w-field`.

**Schrift:** nur der System-Stack. Keine selbst gehostete und keine von Google
geladene Schrift — das wäre Betrieb, den v1 nicht tragen muss, und ein
Google-Fonts-Abruf wäre Netzwerkverkehr am Gateway vorbei (Regel 7).

## Kontrast (nachgerechnet, nicht behauptet)

WCAG 2.1 AA verlangt 4,5:1 für Text und 3:1 für Ränder von Bedienelementen.
Gerechnet mit `contrastRatio()` aus diesem Paket, festgehalten in
`src/tokens/tokens.contrast.test.ts` (59 Prüfungen, hell und dunkel).

| Paar | hell | dunkel |
| --- | --- | --- |
| `fg` auf `bg` | 18,16:1 | 16,34:1 |
| `fg` auf `surface` | 16,94:1 | 14,85:1 |
| `fg-muted` auf `bg` | 6,99:1 | 8,26:1 |
| `fg-muted` auf `surface` | 6,52:1 | 7,51:1 |
| `fg-subtle` auf `bg` | 5,14:1 | 6,33:1 |
| `fg-subtle` auf `surface` | 4,79:1 | 5,75:1 |
| `primary` auf `bg` | 6,83:1 | 8,17:1 |
| `primary-fg` auf `primary` | 6,83:1 | 7,79:1 |
| `primary-subtle-fg` auf `primary-subtle` | 8,51:1 | 10,09:1 |
| `success-fg` auf `success` | 6,51:1 | 9,27:1 |
| `success-subtle-fg` auf `success-subtle` | 7,92:1 | 10,85:1 |
| `warning-fg` auf `warning` | 6,33:1 | 8,79:1 |
| `warning-subtle-fg` auf `warning-subtle` | 7,73:1 | 10,53:1 |
| `danger` auf `bg` | 6,53:1 | 9,46:1 |
| `danger-fg` auf `danger` | 6,53:1 | 9,09:1 |
| `danger-subtle-fg` auf `danger-subtle` | 7,69:1 | 10,79:1 |
| `border-strong` auf `bg` (3:1 genügt) | 4,04:1 | 4,17:1 |
| `border-strong` auf `surface` (3:1 genügt) | 3,77:1 | 3,79:1 |
| `focus` auf `bg` (3:1 genügt) | 6,83:1 | 8,17:1 |
| `focus` auf `surface` (3:1 genügt) | 6,37:1 | 7,43:1 |

`border` (die ruhige Trennlinie) ist bewusst kontrastarm und trägt nie
Information — Bedienelemente benutzen `border-strong`.

## Texte

v1 ist einsprachig deutsch — **aber kein fester Text steht in einer
Komponente.** Alle Texte liegen in `src/strings.ts` als ein typisiertes Objekt
(`UiStrings`). Mehrsprachigkeit ist später der Austausch dieses Moduls, nicht
ein Umbau jeder Komponente.

```ts
import { overrideStrings } from '@openapps/ui';

overrideStrings({
  form: { submit: 'Antrag einreichen' },
  shell: { productName: 'Beispiel GmbH' },
});
```

Nicht genannte Texte bleiben unverändert. Wo eine Komponente schon eine
Text-Prop hat (`loadingLabel`, `emptyLabel`, `signedOutLabel`, …), gewinnt die
Prop. `germanStrings` sind die ausgelieferten Texte, `resetStrings()` stellt sie
wieder her.

`src/strings.test.ts` prüft über die Quellen von `components/`, `patterns/` und
`shell/`, dass dort kein sichtbarer deutscher Text mehr steht — mit fünf Netzen
(Text im JSX, Zeichenketten an Text-Props, Vorgabewerte hinter `??`, alles mit
Umlaut oder typografischem Zeichen, Fehlertexte). Jedes Netz hat einen Test,
der zeigt, dass es greift, und einen, der korrekten Code durchlässt.

## Der Linter

| Regel | Blockiert |
| --- | --- |
| `no-raw-color` | Hex, `rgb()`/`hsl()`/`oklch()`, `bg-[#fff]`, Tailwind-Farbklassen außerhalb der Tokens |
| `no-foreign-ui` | Importe außerhalb der Allowlist (`@openapps/ui`, `@openapps/sdk`, `@openapps/app-manifest`, `react`, `react-dom`, `next`, Tailwind) |
| `require-list-states` | eine Liste (`Table`, `ListPattern`, `.map` in `ul`/`ol`/`tbody`) ohne importierten `EmptyState` **und** `ErrorState` — `ListPattern` zählt als beides |
| `require-form-states` | ein Formular ohne importiertes `FormPattern` |

Jede Regel hat in `lint/test/` einen Fall, der greift, und einen, der korrekten
Code durchlässt.

### Was als Formular gilt

`require-form-states` meldet eine Datei, wenn sie

- ein `<form>` mit mindestens einem Feld enthält, **oder**
- zwei oder mehr Felder (`Input`, `Select`, `Checkbox`, `input`, `textarea`)
  zusammen mit einem Absende-Pfad (`onSubmit`/`onSave`/`onCreate`/`onUpdate`
  oder ein Knopf mit `type="submit"`) enthält,

und `FormPattern` nicht aus `@openapps/ui` importiert. Ein einzelnes Suchfeld
und eine Filterleiste sind damit kein Formular.

Warum der Muster-Import und nicht „hat eine Fehlermeldung": eine Regel, die nur
das Vorhandensein einer `error`-Prop prüft, lässt sich mit einem leeren String
austricksen. `FormPattern` bringt Validierung, `aria-invalid`,
`aria-describedby`, `role="alert"` und die Fehlerzusammenfassung mit.

### Weitere erlaubte Pakete (`allowed-packages.json`)

`no-foreign-ui` bleibt eine Allowlist. Pakete, die kein UI sind und die eine App
trotzdem braucht (`zod`, `date-fns`, …), trägt **die Control Plane** in eine
JSON-Datei im Wurzelverzeichnis des App-Repos ein:

```json
["zod", "date-fns", "@tanstack/react-query"]
```

oder, mit Platz für einen Kommentar:

```json
{ "_kommentar": "Gepflegt von der Control Plane.", "allow": ["zod"] }
```

- Vorgabe-Pfad: `allowed-packages.json`, relativ zum ESLint-Wurzelverzeichnis.
  Über die Option `allowExtraFile` änderbar, `useAllowlistFile: false` schaltet
  das Lesen ganz ab.
- **Fehlt die Datei, gilt nur die eingebaute Allowlist — nie „dann alles
  erlauben".** Dasselbe bei kaputtem JSON oder falschem Format: die Regel meldet
  den Dateifehler einmal und bleibt streng.
- UI-Bibliotheken gehören dort nicht hinein. Oberfläche kommt aus
  `@openapps/ui`, sonst zerfällt das Produktgefühl.

Eine leere Beispieldatei mit Erklärung liegt unter
`lint/allowed-packages.example.json`.

## Entwickeln

```bash
pnpm --filter @openapps/ui test        # vitest + @testing-library/react
pnpm --filter @openapps/ui typecheck
pnpm --filter @openapps/ui lint        # das Paket prüft sich mit seinen eigenen Regeln
pnpm --filter @openapps/ui showcase    # Schaufenster auf http://localhost:4321
```

Das Schaufenster (`showcase/`) zeigt alle Komponenten, alle fünf Muster und die
Shell — mit Umschalter für System / Hell / Dunkel.

## Regeln für App-Agents

1. Keine Farbe außerhalb der Tokens. Auch nicht „nur hier kurz“.
2. Jede Liste hat leeren und Fehlerzustand — am einfachsten über `ListPattern`.
3. Jedes Formular nutzt `FormPattern` — der Linter verlangt den Import.
4. Die Shell kommt von der Plattform. Apps bauen nur ihren Inhalt und reichen
   den Nutzer aus `@openapps/sdk` als `user`-Prop herein. Kein eigener Login.
5. Phone-Breite ohne waagerechtes Scrollen: Container `min-w-0`, lange Texte
   `truncate` oder `[overflow-wrap:anywhere]`.
6. Keinen festen Text in eine Komponente schreiben, die ins Design System
   gehört — er kommt aus `strings`.
