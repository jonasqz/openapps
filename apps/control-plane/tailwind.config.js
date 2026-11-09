/**
 * Das Preset ERSETZT Tailwinds Paletten, es erweitert sie nicht. `bg-blue-500`
 * existiert damit nicht — eine fremde Farbe ist nicht verboten, sie ist nicht
 * erreichbar (docs/05-ui-guide.md).
 *
 * `content` nennt auch die Quellen von `@openapps/ui`: Ohne sie wirft Tailwind
 * genau die Klassen weg, die die Komponenten benutzen, und die Oberfläche kommt
 * unformatiert an.
 */
import preset from '@openapps/ui/tailwind-preset';

/** @type {import('tailwindcss').Config} */
export default {
  presets: [preset],
  content: ['./src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
};
