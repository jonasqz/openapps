/**
 * Generiert `src/tokens/tokens.css` und `tailwind/preset.js` aus `tokens.ts`.
 *
 *   node --experimental-strip-types src/tokens/generate.ts
 *
 * Kein Build-Tool, keine zusätzliche Abhängigkeit. Die erzeugten Dateien sind
 * eingecheckt; `tokens.generated.test.ts` prüft, dass sie aktuell sind.
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  color,
  font,
  fontSize,
  fontWeight,
  prefix,
  radius,
  screens,
  shadow,
  size,
  space,
  zIndex,
} from './tokens.ts';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..', '..');

const HEADER = `/* GENERIERT aus src/tokens/tokens.ts — nicht von Hand ändern.
   Neu erzeugen: pnpm --filter @openapps/ui tokens */`;

/** `0.5` ist kein gültiger CSS-Ident — deshalb `--oa-space-0_5`. */
const safe = (name: string) => name.replace(/\./g, '_');
const v = (group: string, name: string) => `--${prefix}-${group}-${safe(name)}`;

function colorBlock(mode: 'light' | 'dark'): string {
  return Object.entries(color)
    .map(([name, value]) => `  ${v('color', name)}: ${value[mode]};`)
    .join('\n');
}

function shadowBlock(mode: 'light' | 'dark'): string {
  return Object.entries(shadow)
    .map(([name, value]) => {
      const resolved = typeof value === 'string' ? value : value[mode];
      return `  ${v('shadow', name)}: ${resolved};`;
    })
    .join('\n');
}

function staticBlock(): string {
  const lines: string[] = [];
  for (const [name, value] of Object.entries(space)) lines.push(`  ${v('space', name)}: ${value};`);
  for (const [name, value] of Object.entries(size)) lines.push(`  ${v('size', name)}: ${value};`);
  for (const [name, value] of Object.entries(radius)) lines.push(`  ${v('radius', name)}: ${value};`);
  for (const [name, value] of Object.entries(font)) lines.push(`  ${v('font', name)}: ${value};`);
  for (const [name, value] of Object.entries(fontSize)) {
    lines.push(`  ${v('text', name)}: ${value.size};`);
    lines.push(`  ${v('leading', name)}: ${value.leading};`);
  }
  for (const [name, value] of Object.entries(fontWeight)) lines.push(`  ${v('weight', name)}: ${value};`);
  for (const [name, value] of Object.entries(screens)) lines.push(`  ${v('screen', name)}: ${value};`);
  for (const [name, value] of Object.entries(zIndex)) lines.push(`  ${v('z', name)}: ${value};`);
  return lines.join('\n');
}

const css = `${HEADER}

/* Hell ist die Voreinstellung. */
:root {
${staticBlock()}

${colorBlock('light')}

${shadowBlock('light')}

  color-scheme: light;
}

/* Dunkel, wenn das System es wünscht — es sei denn, hell ist erzwungen. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
${colorBlock('dark')}

${shadowBlock('dark')}

    color-scheme: dark;
  }
}

/* Dunkel erzwungen. */
:root[data-theme='dark'],
[data-theme='dark'] {
${colorBlock('dark')}

${shadowBlock('dark')}

  color-scheme: dark;
}

/* Hell erzwungen — gewinnt gegen die System-Voreinstellung. */
:root[data-theme='light'],
[data-theme='light'] {
${colorBlock('light')}

${shadowBlock('light')}

  color-scheme: light;
}

/* Grundlayer. Keine App setzt Body-Farben selbst. */
*,
*::before,
*::after {
  border-color: var(${v('color', 'border')});
}

html {
  font-family: var(${v('font', 'sans')});
  -webkit-text-size-adjust: 100%;
}

body {
  margin: 0;
  background-color: var(${v('color', 'bg')});
  color: var(${v('color', 'fg')});
  font-size: var(${v('text', 'base')});
  line-height: var(${v('leading', 'base')});
  -webkit-font-smoothing: antialiased;
}

/* Fokus ist immer sichtbar. */
:focus-visible {
  outline: 2px solid var(${v('color', 'focus')});
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
`;

const colorMap = Object.keys(color)
  .map((name) => `      '${name}': 'var(${v('color', name)})',`)
  .join('\n');
const spaceMap = Object.keys(space)
  .map((name) => `      '${name}': 'var(${v('space', name)})',`)
  .join('\n');
const radiusMap = Object.keys(radius)
  .map((name) => `      '${name}': 'var(${v('radius', name)})',`)
  .join('\n');
const textMap = Object.keys(fontSize)
  .map((name) => `      '${name}': ['var(${v('text', name)})', { lineHeight: 'var(${v('leading', name)})' }],`)
  .join('\n');
const weightMap = Object.keys(fontWeight)
  .map((name) => `      '${name}': 'var(${v('weight', name)})',`)
  .join('\n');
const shadowMap = Object.keys(shadow)
  .map((name) => `      '${name}': 'var(${v('shadow', name)})',`)
  .join('\n');
const screenMap = Object.entries(screens)
  .map(([name, value]) => `      '${name}': '${value}',`)
  .join('\n');
const sizeMap = Object.keys(size)
  .map((name) => `      '${name}': 'var(${v('size', name)})',`)
  .join('\n');
const zMap = Object.keys(zIndex)
  .map((name) => `      '${name}': 'var(${v('z', name)})',`)
  .join('\n');

const preset = `${HEADER}

/**
 * Tailwind-Preset von @openapps/ui.
 *
 * Es ERSETZT die Standard-Paletten von Tailwind (colors, spacing, radius,
 * fontSize, boxShadow). Dadurch existiert \`bg-blue-500\` gar nicht — eine App
 * kann an keine fremde Farbe kommen, auch nicht aus Versehen. Erlaubt sind nur
 * die Tokens aus src/tokens/tokens.ts.
 */
export default {
  darkMode: ['variant', ['@media (prefers-color-scheme: dark) { &:not([data-theme="light"] *) }', '[data-theme="dark"] &']],
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      inherit: 'inherit',
${colorMap}
    },
    spacing: {
${spaceMap}
    },
    borderRadius: {
${radiusMap}
    },
    fontFamily: {
      sans: 'var(${v('font', 'sans')})',
      mono: 'var(${v('font', 'mono')})',
    },
    fontSize: {
${textMap}
    },
    fontWeight: {
${weightMap}
    },
    boxShadow: {
${shadowMap}
    },
    screens: {
${screenMap}
    },
    zIndex: {
${zMap}
    },
    extend: {
      /** Benannte Layout-Breiten — siehe \`size\` in src/tokens/tokens.ts. */
      width: {
${sizeMap}
      },
      minWidth: {
${sizeMap}
      },
      maxWidth: {
${sizeMap}
      },
      maxHeight: {
${sizeMap}
      },
      minHeight: ({ theme }) => ({ ...theme('spacing') }),
      outlineColor: ({ theme }) => theme('colors'),
      ringColor: ({ theme }) => theme('colors'),
      keyframes: {
        'oa-spin': { to: { transform: 'rotate(360deg)' } },
        'oa-fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'oa-slide-in': {
          from: { opacity: '0', transform: 'translateY(0.5rem)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'oa-spin': 'oa-spin 0.7s linear infinite',
        'oa-fade-in': 'oa-fade-in 0.15s ease-out',
        'oa-slide-in': 'oa-slide-in 0.18s ease-out',
      },
    },
  },
};
`;

writeFileSync(resolve(pkgRoot, 'src/tokens/tokens.css'), css, 'utf8');
writeFileSync(resolve(pkgRoot, 'tailwind/preset.js'), preset, 'utf8');
console.log('tokens.css und tailwind/preset.js erzeugt');
