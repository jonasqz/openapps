/**
 * Die einzige Quelle für Farben, Abstände, Schrift, Radien und Schatten.
 *
 * Alles andere ist abgeleitet: `tokens.css` (CSS-Variablen) und
 * `tailwind/preset.js` werden aus dieser Datei generiert
 * (`pnpm --filter @openapps/ui tokens`). Ein Test prüft, dass die
 * generierten Dateien zur Quelle passen.
 *
 * Kontrastwerte sind in `README.md` nachgerechnet und in
 * `src/tokens/tokens.contrast.test.ts` als Test festgehalten.
 */

/**
 * Semantische Farbrollen. Jede Rolle hat einen Wert für hell und für dunkel.
 *
 * Richtung (ADR 0010): Schwarz/Weiß mit genau einer Akzentfarbe, einem
 * Blaugrau. Graustufen sind neutral, nicht getönt; die Akzentfarbe trägt
 * Bedienung, Auswahl und Fokus. Erfolg, Warnung und Gefahr sind gedämpft und
 * erscheinen nur, wo ein Zustand das verlangt.
 */
export const color = {
  /** Seitenhintergrund. */
  bg: { light: '#ffffff', dark: '#0b0b0c' },
  /** Leicht abgesetzter Seitenhintergrund (z. B. Shell-Rand, Login). */
  'bg-subtle': { light: '#f5f5f4', dark: '#070708' },
  /** Hintergrund erhobener Flächen: Card, Dialog, Tabellenkopf. */
  surface: { light: '#fafafa', dark: '#131314' },
  /** Surface im Hover/Active-Zustand. */
  'surface-hover': { light: '#f1f1f0', dark: '#1a1a1c' },
  /** Ruhige Füllfläche ohne Interaktion (z. B. Skeleton, Fortschrittsspur). */
  'surface-muted': { light: '#ededec', dark: '#202022' },
  /** Haarlinien: Trennlinien und Ränder ohne Bedienfunktion. */
  border: { light: '#e4e4e2', dark: '#242426' },
  /** Ränder bedienbarer Elemente — mindestens 3:1 gegen bg und surface. */
  'border-strong': { light: '#8a8a88', dark: '#707074' },
  /** Fließtext und Überschriften. */
  fg: { light: '#0b0b0c', dark: '#f2f2f0' },
  /** Sekundärtext, Labels, Hilfetexte. */
  'fg-muted': { light: '#55565a', dark: '#a6a6a8' },
  /** Platzhalter und deaktivierter Text — nie für wichtige Information. */
  'fg-subtle': { light: '#6a6b6f', dark: '#8e8e92' },
  /** Text auf einer gefüllten, invertierten Fläche (z. B. Toast). */
  'fg-inverted': { light: '#ffffff', dark: '#0b0b0c' },

  /** Die eine Akzentfarbe: Blaugrau. */
  primary: { light: '#4c5d72', dark: '#9cadc2' },
  'primary-hover': { light: '#3b4859', dark: '#bac8d8' },
  'primary-fg': { light: '#ffffff', dark: '#0b0e13' },
  'primary-subtle': { light: '#edf0f4', dark: '#171c23' },
  'primary-subtle-fg': { light: '#38465a', dark: '#c2cedc' },

  success: { light: '#22663e', dark: '#7fc496' },
  'success-fg': { light: '#ffffff', dark: '#06170c' },
  'success-subtle': { light: '#ecf4ef', dark: '#0f1d14' },
  'success-subtle-fg': { light: '#1b5232', dark: '#a9d9b8' },

  warning: { light: '#83560f', dark: '#d6ae67' },
  'warning-fg': { light: '#ffffff', dark: '#1d1404' },
  'warning-subtle': { light: '#f7f0e3', dark: '#221a0c' },
  'warning-subtle-fg': { light: '#664208', dark: '#e9d0a0' },

  danger: { light: '#a3312b', dark: '#ee8f88' },
  'danger-hover': { light: '#842520', dark: '#f4b2ad' },
  'danger-fg': { light: '#ffffff', dark: '#290907' },
  'danger-subtle': { light: '#f8ecea', dark: '#261211' },
  'danger-subtle-fg': { light: '#842520', dark: '#f4beb9' },

  /** Fokusring. Immer sichtbar, nie `outline: none` ohne Ersatz. */
  focus: { light: '#4c5d72', dark: '#9cadc2' },
  /** Abdunklung hinter Dialogen. */
  overlay: { light: 'rgb(11 11 12 / 0.40)', dark: 'rgb(0 0 0 / 0.66)' },
} as const;

/** Abstandsskala in rem. Schlüssel sind die Tailwind-Suffixe (`p-4`, `gap-2`). */
export const space = {
  '0': '0rem',
  px: '0.0625rem',
  '0.5': '0.125rem',
  '1': '0.25rem',
  '1.5': '0.375rem',
  '2': '0.5rem',
  '2.5': '0.625rem',
  '3': '0.75rem',
  '4': '1rem',
  '5': '1.25rem',
  '6': '1.5rem',
  '8': '2rem',
  '10': '2.5rem',
  '12': '3rem',
  '16': '4rem',
  '20': '5rem',
  '24': '6rem',
} as const;

/**
 * Feste Layout-Breiten. Die Abstandsskala endet bei 6rem — damit gibt es
 * `w-60` aus Tailwind nicht mehr, und Breiten für Navigation, Schublade und
 * Menüs bekommen hier einen Namen statt einen Zahlenwert im Markup.
 */
export const size = {
  nav: '15rem',
  drawer: '18rem',
  menu: '16rem',
  panel: '20rem',
  /** Maximale Höhe scrollender Flächen (Menü, Meldungsliste). */
  scroll: '20rem',
  field: '12rem',
} as const;

/**
 * Fast eckig. Flächen und Felder haben kaum Rundung, damit Haarlinien und
 * Raster die Form tragen; `full` bleibt für Pillen (Knöpfe, Filter, Avatare).
 */
export const radius = {
  none: '0rem',
  sm: '0.125rem',
  md: '0.1875rem',
  lg: '0.25rem',
  xl: '0.375rem',
  '2xl': '0.5rem',
  full: '9999px',
} as const;

/**
 * Nur Schriften des Betriebssystems. Keine selbst gehostete und keine von
 * Google geladene Schrift: eine eigene Schrift wäre Betrieb, und ein
 * Google-Fonts-Abruf wäre Netzwerkverkehr am Gateway vorbei (Regel 7).
 *
 * Drei Rollen:
 * - `sans`: Grotesk für alles Lesbare. Helvetica Neue zuerst, sonst die
 *   Systemschrift.
 * - `mono`: Kennungen, Zahlen, Labels in Versalien.
 * - `display`: Serife nur für Seitentitel und große Zahlen. Nie für Fließtext.
 */
export const font = {
  sans:
    "'Helvetica Neue', Helvetica, ui-sans-serif, system-ui, -apple-system, " +
    "'Segoe UI', Roboto, Arial, 'Noto Sans', sans-serif, 'Apple Color Emoji', " +
    "'Segoe UI Emoji'",
  mono:
    "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, 'Cascadia Mono', Consolas, " +
    "'Liberation Mono', monospace",
  display:
    "'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', " +
    "ui-serif, Georgia, 'Noto Serif', 'Times New Roman', serif",
} as const;

/**
 * Schriftgrößen mit fester Zeilenhöhe — Zeilenhöhe ist kein freier Wert.
 * `2xs` ist die Größe für Mono-Labels in Versalien, `4xl`/`5xl` sind
 * Display-Größen für Seitentitel und Kennzahlen.
 */
export const fontSize = {
  '2xs': { size: '0.6875rem', leading: '1rem' },
  xs: { size: '0.75rem', leading: '1.125rem' },
  sm: { size: '0.875rem', leading: '1.375rem' },
  base: { size: '1rem', leading: '1.5rem' },
  lg: { size: '1.125rem', leading: '1.625rem' },
  xl: { size: '1.25rem', leading: '1.75rem' },
  '2xl': { size: '1.5rem', leading: '1.875rem' },
  '3xl': { size: '1.875rem', leading: '2.25rem' },
  '4xl': { size: '2.25rem', leading: '2.5rem' },
  '5xl': { size: '3rem', leading: '3.125rem' },
} as const;

/**
 * Laufweite. `label` ist für Mono in Versalien (Eyebrows, Tabellenköpfe,
 * Badges), `loose` für sehr kurze Marken, `display` zieht große Serifen
 * zusammen. Die Namen kollidieren bewusst nicht mit Tailwinds `tight`,
 * `wide` usw., damit bestehende Klassen ihre Bedeutung behalten.
 */
export const tracking = {
  display: '-0.02em',
  label: '0.08em',
  loose: '0.14em',
} as const;

export const fontWeight = {
  normal: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

/**
 * Schatten sind die Ausnahme. Flächen trennen sich durch Haarlinien; Schatten
 * bekommen nur Ebenen, die über dem Inhalt schweben (Menü, Dialog, Toast).
 */
export const shadow = {
  none: 'none',
  sm: { light: '0 1px 0 0 rgb(11 11 12 / 0.04)', dark: '0 1px 0 0 rgb(0 0 0 / 0.5)' },
  md: {
    light: '0 1px 2px 0 rgb(11 11 12 / 0.04), 0 12px 32px -12px rgb(11 11 12 / 0.18)',
    dark: '0 1px 2px 0 rgb(0 0 0 / 0.6), 0 12px 32px -12px rgb(0 0 0 / 0.8)',
  },
  lg: {
    light: '0 2px 6px -2px rgb(11 11 12 / 0.06), 0 32px 64px -24px rgb(11 11 12 / 0.28)',
    dark: '0 2px 6px -2px rgb(0 0 0 / 0.7), 0 32px 64px -24px rgb(0 0 0 / 0.9)',
  },
} as const;

/** Breakpoints. `sm` ist die Phone-Grenze: darunter einspaltig, nie Querscroll. */
export const screens = {
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
} as const;

/** Z-Ebenen, damit kein `z-[9999]` entsteht. */
export const zIndex = {
  base: '0',
  sticky: '10',
  shell: '20',
  dropdown: '30',
  overlay: '40',
  dialog: '50',
  toast: '60',
} as const;

export const prefix = 'oa';

export type ColorToken = keyof typeof color;
export type SpaceToken = keyof typeof space;
export type SizeToken = keyof typeof size;
export type RadiusToken = keyof typeof radius;
export type FontSizeToken = keyof typeof fontSize;
export type ShadowToken = keyof typeof shadow;
export type TrackingToken = keyof typeof tracking;
