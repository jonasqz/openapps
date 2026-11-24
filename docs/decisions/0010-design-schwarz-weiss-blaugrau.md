# ADR 0010: Design-Richtung Schwarz/Weiß mit einer Akzentfarbe Blaugrau

Stand 2026-11-24 · angenommen

## Kontext

Das erste Design System (ADR 0002) war korrekt, aber austauschbar: Systemblau
als Akzent, getönte Grauflächen, Zebra-Tabellen, runde Ecken, Schatten. Der
Klickdummy der Control Plane wirkte dadurch brav und generisch. Gewünscht ist
ein Auftritt, der hochwertig und ruhig wirkt und trotzdem zu einem
Admin-Werkzeug passt.

Als Stilvorlage diente staaff.ai. Übernommen werden sollten die Typografie,
der Rhythmus, die Haarlinien, das Raster, die Monospace-Details und die
Zurückhaltung. Die Retro-Elemente der Vorlage (Fenster, Titelleisten,
Desktop-Optik, Pixel-Look) gehören nicht dazu.

Randbedingungen: Eine parallele Session baut Apps auf `packages/ui`. Deshalb
bleiben die Namen der `--oa-*`-Tokens und die Props der Komponenten stabil.
Webfonts kommen nicht in Frage, weil ein Abruf bei Google am Gateway vorbeiginge
und eine selbst gehostete Schrift Betrieb wäre (Regel 7). Kontrast nach WCAG AA
ist per Test festgeschrieben.

## Entscheidung

1. **Farbe.** Neutrale Graustufen ohne Tönung, Weiß auf Fast-Schwarz und
   umgekehrt. Es gibt genau eine Akzentfarbe, Blaugrau: `#4c5d72` hell und
   `#9cadc2` dunkel. Sie färbt den Primärknopf, den Fokusring, die aktive
   Navigation und Auswahlen. Erfolg, Warnung und Gefahr bleiben als Rollen
   erhalten, sind aber gedämpft.
2. **Linien statt Schatten.** Flächen trennt eine Haarlinie (`border`).
   Karten stehen in einem Haarlinien-Raster. Schatten gibt es nur für Ebenen,
   die über dem Inhalt schweben: Menü, Dialog und Toast.
3. **Form.** Die Radien sind fast eckig (2 bis 8 px). Die einzige runde Form
   ist die Pille, und die bekommen nur Bedienelemente: Knöpfe, Filter,
   Avatare. So unterscheidet man auf einen Blick, was klickbar ist und was
   Fläche.
4. **Drei Schriftrollen, alle aus dem System.**
   - `font-sans`: Helvetica Neue oder die Systemschrift, für alles Lesbare.
   - `font-mono`: für Kennungen, Zahlen und Labels. Das wiederkehrende Detail
     ist das Mono-Label in Versalien mit weiter Laufweite
     (`font-mono text-2xs uppercase tracking-label`). Es steht an Eyebrows,
     Tabellenköpfen, Feldlabels, Badges und der Wortmarke.
   - `font-display`: eine Serife (Iowan Old Style, Palatino, Georgia), nur für
     Seitentitel, Dialogtitel, Leer-Zustände und große Kennzahlen.
5. **Rhythmus.** Seitentitel groß und mit Luft, darunter eine Haarlinie.
   Abschnitte beginnen mit einem Mono-Label, dem eine Linie folgt. Tabellen
   haben keine Zebrastreifen. Der Leer-Zustand ist gestrichelt und trägt ein
   `[ ∅ leer ]`, der Fehlerzustand ist rot gerahmt und trägt ein `[ ! Fehler ]`.
6. **Nur additive Tokens.** Neu sind `--oa-font-display`, `--oa-tracking-*`
   (`display`, `label`, `loose`) und die Schriftgrößen `2xs`, `4xl`, `5xl`.
   Kein bestehender Token-Name und keine Komponenten-Prop hat sich geändert.
   Die Laufweiten heißen bewusst nicht `tight` oder `wide`, damit Tailwinds
   gleichnamige Klassen ihre Bedeutung behalten.

## Folgen

- Apps auf `packages/ui` sehen ohne Codeänderung neu aus. Wer eigene
  Überschriften setzt, sollte für Seitentitel `font-display` nehmen und für
  Labels das Mono-Label.
- Alle Kontrastpaare bestehen weiterhin AA. Die Tabelle in
  `packages/ui/README.md` ist neu gerechnet.
- Die Darstellung hängt von installierten Schriften ab. Unter Windows und Linux
  greifen Georgia, Palatino Linotype bzw. Noto Serif. Das ist gewollt und
  bleibt lesbar.
- Der Klickdummy liegt jetzt im Repo unter
  `docs/klickdummy/openapps-control-plane.html`. Sein Token-Block ist aus
  `tokens.css` kopiert.

## Alternativen

- **Akzent bleibt Systemblau.** Das wäre sicher, aber genau der generische
  Eindruck, den wir loswerden wollen.
- **Ganz ohne Akzent, nur Schwarz/Weiß.** Das ist zu streng für ein Werkzeug.
  Fokus und Auswahl brauchen ein Signal, das sich von Text unterscheidet.
- **Webfont, etwa eine Grotesk und eine Serife über Google Fonts.** Die Optik
  wäre näher an der Vorlage, verstößt aber gegen Regel 7. Self-Hosting wäre
  möglich, ist aber Betrieb, den v1 nicht tragen soll.
- **Retro-Elemente der Vorlage übernehmen (Fenster, Titelleisten).** Das ist
  ausdrücklich nicht gewünscht und passt nicht zu einem Admin-Werkzeug.
