# ADR 0002: App-Shell plus Design System (Weg A)

Stand 2026-11-09 · angenommen

## Kontext

Die Apps werden von Agents gebaut und sollen sich trotzdem wie ein Produkt
anfühlen, nicht wie zwanzig einzelne Tools. Drei Wege wurden geprüft.

| Weg | Was es ist | Stärke | Schwäche |
| --- | --- | --- | --- |
| A: App-Shell + UI-Kit | Plattform liefert die Hülle: Navigation, App-Wechsler, Login, Profil, Benachrichtigungen. Dazu ein UI-Kit (shadcn/ui mit eigenen Tokens) im Starter-Template | Einheitliches Gefühl, Apps bauen nur ihren Inhalt | Shell muss stabil und gut gemacht sein |
| B: Nur UI-Kit | Gemeinsame Komponenten und Tokens, jede App eigenständig | Einfach, wenig Kopplung | Apps wirken verstreut, keine gemeinsame Navigation |
| C: Generierte UI | Standard-Screens aus OpenAPI/Tools erzeugt, eigener Code nur für Besonderes | Passt am besten zu Agents first, sehr wenig Code pro App | Generierte Screens wirken schnell generisch |

## Entscheidung

**A** für v1: App-Shell plus Design System.

## Folgen

- Die Shell ist eigener, getesteter Code und wird nicht von App-Agents geändert.
  Ihre Qualität ist der Hebel für das Produktgefühl — und ihr Risiko.
- Einheitlichkeit wird erzwungen, nicht erhofft: Design System als Paket,
  UI-Guide in `AGENTS.md`, Linter plus Screenshot-Prüfung im Review-Gate.
- Apps bleiben eigenständige Next.js-Anwendungen; die Shell umschließt sie, sie
  wird nicht zum Monolithen.

## Alternativen

- **C (generierte UI)** ist verworfen: Generierte Screens wirken schnell wie ein
  Admin-Panel, und Sonderfälle werden umständlich. Der Weg bleibt für einzelne
  Standard-Screens (Listen, Formulare) als Beschleuniger offen, nicht als Modell
  für die App.
- **B (nur UI-Kit)** ist verworfen: ohne gemeinsame Navigation bleibt es eine
  Sammlung von Tools, und genau das soll es nicht sein.
