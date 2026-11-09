/**
 * Die Farbnamen, die der Linter kennt.
 *
 * Erzeugt aus dem Tailwind-Preset — dieses wiederum aus
 * `src/tokens/tokens.ts`. Dadurch gibt es auch für den Linter nur eine Quelle:
 * ein neues Token ist automatisch erlaubt, ein getilgtes automatisch verboten.
 */
import preset from '../../tailwind/preset.js';

export const COLOR_TOKENS = Object.keys(preset.theme.colors);

/** Tailwind-Hilfsklassen, die eine Farbe setzen. */
export const COLOR_UTILITIES = [
  'bg',
  'text',
  'border',
  'border-x',
  'border-y',
  'border-t',
  'border-r',
  'border-b',
  'border-l',
  'divide',
  'ring',
  'ring-offset',
  'outline',
  'shadow',
  'fill',
  'stroke',
  'accent',
  'caret',
  'decoration',
  'from',
  'via',
  'to',
  'placeholder',
];

/**
 * Tailwind-Klassen, die mit einem Farb-Utility anfangen, aber keine Farbe
 * setzen — sie dürfen nicht als „fremde Farbe" gemeldet werden.
 */
export const NON_COLOR_SUFFIXES = new Set([
  // Aus dem Preset abgeleitet: Größen und Schatten, die wie Farben aussehen
  // (`text-sm`, `shadow-md`, `border-2`), aber keine sind.
  ...Object.keys(preset.theme.fontSize),
  ...Object.keys(preset.theme.boxShadow),
  ...Object.keys(preset.theme.spacing),
  // text-*
  'xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl',
  'left', 'center', 'right', 'justify', 'start', 'end',
  'wrap', 'nowrap', 'balance', 'pretty', 'ellipsis', 'clip',
  // border-* — Seiten ohne Farbe: border-b, border-x, border-s
  't', 'r', 'b', 'l', 'x', 'y', 's', 'e',
  'solid', 'dashed', 'dotted', 'double', 'hidden', 'none',
  'collapse', 'separate',
  // shadow-*
  'inner',
  // bg-*
  'fixed', 'local', 'scroll', 'bottom', 'top', 'auto', 'cover', 'contain',
  'repeat', 'no-repeat', 'origin-border', 'origin-padding', 'origin-content',
  'blend-normal', 'blend-multiply', 'blend-screen', 'blend-overlay',
  'gradient-to-t', 'gradient-to-tr', 'gradient-to-r', 'gradient-to-br',
  'gradient-to-b', 'gradient-to-bl', 'gradient-to-l', 'gradient-to-tl',
  'clip-text', 'clip-border', 'clip-padding', 'clip-content',
  // outline-*
  'offset-0', 'offset-1', 'offset-2', 'offset-4', 'offset-8',
  // decoration-*
  'underline', 'overline', 'line-through',
  'slice', 'clone',
  // ring-*
  'inset',
]);
