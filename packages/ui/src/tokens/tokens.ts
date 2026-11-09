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

/** Semantische Farbrollen. Jede Rolle hat einen Wert für hell und für dunkel. */
export const color = {
  /** Seitenhintergrund. */
  bg: { light: '#ffffff', dark: '#0b0f14' },
  /** Leicht abgesetzter Seitenhintergrund (z. B. Shell-Rand). */
  'bg-subtle': { light: '#f1f3f6', dark: '#070a0e' },
  /** Hintergrund erhobener Flächen: Card, Dialog, Tabellenkopf. */
  surface: { light: '#f6f7f9', dark: '#141a23' },
  /** Surface im Hover/Active-Zustand. */
  'surface-hover': { light: '#eceff3', dark: '#1b232e' },
  /** Ruhige Füllfläche ohne Interaktion (z. B. Skeleton, Zebra-Zeile). */
  'surface-muted': { light: '#e6e9ee', dark: '#1f2834' },
  /** Trennlinien und Ränder ohne Bedienfunktion. */
  border: { light: '#d5dae2', dark: '#2a3340' },
  /** Ränder bedienbarer Elemente — mindestens 3:1 gegen bg und surface. */
  'border-strong': { light: '#767f8e', dark: '#697689' },
  /** Fließtext und Überschriften. */
  fg: { light: '#11161d', dark: '#e8edf4' },
  /** Sekundärtext, Labels, Hilfetexte. */
  'fg-muted': { light: '#505a68', dark: '#a0abba' },
  /** Platzhalter und deaktivierter Text — nie für wichtige Information. */
  'fg-subtle': { light: '#666e7c', dark: '#8a95a4' },
  /** Text auf einer gefüllten Akzentfläche. */
  'fg-inverted': { light: '#ffffff', dark: '#08142c' },

  primary: { light: '#1a4fd0', dark: '#7ea8ff' },
  'primary-hover': { light: '#163fa8', dark: '#a3c0ff' },
  'primary-fg': { light: '#ffffff', dark: '#08142c' },
  'primary-subtle': { light: '#e7eeff', dark: '#152543' },
  'primary-subtle-fg': { light: '#113a9e', dark: '#bcd3ff' },

  success: { light: '#146c35', dark: '#6fd392' },
  'success-fg': { light: '#ffffff', dark: '#05210f' },
  'success-subtle': { light: '#e6f5ec', dark: '#0e2b1a' },
  'success-subtle-fg': { light: '#0f5529', dark: '#a8e8bf' },

  warning: { light: '#8a5300', dark: '#e8b45c' },
  'warning-fg': { light: '#ffffff', dark: '#2a1c00' },
  'warning-subtle': { light: '#fdf1dc', dark: '#332406' },
  'warning-subtle-fg': { light: '#6d4200', dark: '#f3d49a' },

  danger: { light: '#b3252c', dark: '#ff9a99' },
  'danger-hover': { light: '#8f1c22', dark: '#ffbcbb' },
  'danger-fg': { light: '#ffffff', dark: '#2b0708' },
  'danger-subtle': { light: '#fdeaea', dark: '#3a1416' },
  'danger-subtle-fg': { light: '#8f1c22', dark: '#ffc4c3' },

  /** Fokusring. Immer sichtbar, nie `outline: none` ohne Ersatz. */
  focus: { light: '#1a4fd0', dark: '#7ea8ff' },
  /** Abdunklung hinter Dialogen. */
  overlay: { light: 'rgb(17 22 29 / 0.55)', dark: 'rgb(2 4 8 / 0.7)' },
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

export const radius = {
  none: '0rem',
  sm: '0.25rem',
  md: '0.375rem',
  lg: '0.5rem',
  xl: '0.75rem',
  '2xl': '1rem',
  full: '9999px',
} as const;

/**
 * Nur die Schrift des Betriebssystems. Keine selbst gehostete und keine von
 * Google geladene Schrift: eine eigene Schrift wäre Betrieb, und ein
 * Google-Fonts-Abruf wäre Netzwerkverkehr am Gateway vorbei (Regel 7).
 */
export const font = {
  sans:
    "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, " +
    "'Helvetica Neue', Arial, 'Noto Sans', sans-serif, 'Apple Color Emoji', " +
    "'Segoe UI Emoji'",
  mono:
    "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, " +
    "'Liberation Mono', monospace",
} as const;

/** Schriftgrößen mit fester Zeilenhöhe — Zeilenhöhe ist kein freier Wert. */
export const fontSize = {
  xs: { size: '0.75rem', leading: '1.125rem' },
  sm: { size: '0.875rem', leading: '1.3125rem' },
  base: { size: '1rem', leading: '1.5rem' },
  lg: { size: '1.125rem', leading: '1.6875rem' },
  xl: { size: '1.25rem', leading: '1.75rem' },
  '2xl': { size: '1.5rem', leading: '2rem' },
  '3xl': { size: '1.875rem', leading: '2.375rem' },
} as const;

export const fontWeight = {
  normal: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

export const shadow = {
  none: 'none',
  sm: { light: '0 1px 2px 0 rgb(17 22 29 / 0.08)', dark: '0 1px 2px 0 rgb(0 0 0 / 0.6)' },
  md: {
    light: '0 2px 4px -1px rgb(17 22 29 / 0.10), 0 4px 12px -2px rgb(17 22 29 / 0.08)',
    dark: '0 2px 4px -1px rgb(0 0 0 / 0.7), 0 4px 12px -2px rgb(0 0 0 / 0.5)',
  },
  lg: {
    light: '0 8px 24px -4px rgb(17 22 29 / 0.14), 0 2px 6px -2px rgb(17 22 29 / 0.08)',
    dark: '0 8px 24px -4px rgb(0 0 0 / 0.8), 0 2px 6px -2px rgb(0 0 0 / 0.6)',
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
