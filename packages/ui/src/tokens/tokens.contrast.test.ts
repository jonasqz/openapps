import { describe, expect, it } from 'vitest';
import { color } from './tokens.ts';
import { contrastRatio } from './contrast.ts';

/**
 * Die Kontrastwerte sind nicht behauptet, sie sind hier nachgerechnet.
 *
 * - Text: WCAG 1.4.3 Level AA = 4.5:1 (normal), 3:1 (groß).
 * - Bedienelement-Ränder: WCAG 1.4.11 = 3:1.
 */
const TEXT_AA = 4.5;
const UI_AA = 3;

/** Text-auf-Fläche-Paare, die in den Komponenten tatsächlich vorkommen. */
const TEXT_PAIRS: ReadonlyArray<[keyof typeof color, keyof typeof color]> = [
  ['fg', 'bg'],
  ['fg', 'surface'],
  ['fg', 'bg-subtle'],
  ['fg-muted', 'bg'],
  ['fg-muted', 'surface'],
  ['fg-muted', 'surface-muted'],
  ['fg-subtle', 'bg'],
  ['fg-subtle', 'surface'],
  ['primary', 'bg'],
  ['primary', 'surface'],
  ['primary-fg', 'primary'],
  ['primary-subtle-fg', 'primary-subtle'],
  ['success-fg', 'success'],
  ['success-subtle-fg', 'success-subtle'],
  ['warning-fg', 'warning'],
  ['warning-subtle-fg', 'warning-subtle'],
  ['danger', 'bg'],
  ['danger', 'surface'],
  ['danger-fg', 'danger'],
  ['danger-subtle-fg', 'danger-subtle'],
];

/** Ränder und Fokus: Bedienelemente, deshalb 3:1. */
const UI_PAIRS: ReadonlyArray<[keyof typeof color, keyof typeof color]> = [
  ['border-strong', 'bg'],
  ['border-strong', 'surface'],
  ['focus', 'bg'],
  ['focus', 'surface'],
  ['focus', 'bg-subtle'],
  ['primary', 'bg'],
  ['danger', 'bg'],
];

describe.each(['light', 'dark'] as const)('Kontrast im Modus %s', (mode) => {
  it.each(TEXT_PAIRS)('Text %s auf %s erreicht AA (4,5:1)', (front, back) => {
    const ratio = contrastRatio(color[front][mode], color[back][mode]);
    expect(ratio, `${front} auf ${back} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(TEXT_AA);
  });

  it.each(UI_PAIRS)('Bedienelement %s auf %s erreicht 3:1', (front, back) => {
    const ratio = contrastRatio(color[front][mode], color[back][mode]);
    expect(ratio, `${front} auf ${back} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(UI_AA);
  });

  it('hell und dunkel sind gleichwertig: jede Rolle hat beide Werte', () => {
    for (const [name, value] of Object.entries(color)) {
      expect(value[mode], `${name} fehlt im Modus ${mode}`).toBeTruthy();
    }
  });
});

it('Hell und Dunkel unterscheiden sich wirklich (kein kopierter Modus)', () => {
  const differing = Object.values(color).filter(
    (value) => (value.light as string) !== (value.dark as string),
  );
  expect(differing.length).toBeGreaterThan(Object.keys(color).length / 2);
});
