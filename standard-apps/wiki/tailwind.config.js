/**
 * Das Preset ERSETZT Tailwinds Paletten. `bg-blue-500` existiert damit nicht —
 * eine fremde Farbe ist nicht verboten, sie ist nicht erreichbar. Layout-Breiten
 * heißen `w-nav`, `w-drawer`, `w-menu`, `w-panel`.
 */
import preset from '@openapps/ui/tailwind-preset';

/** @type {import('tailwindcss').Config} */
export default {
  presets: [preset],
  content: ['./src/**/*.{ts,tsx}', './node_modules/@openapps/ui/src/**/*.{ts,tsx}'],
};
