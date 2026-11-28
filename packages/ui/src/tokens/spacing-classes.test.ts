import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { space } from './tokens.ts';

/**
 * Das Preset ersetzt Tailwinds Abstandsskala. Eine Klasse wie `px-3.5` oder
 * `top-14` gibt es deshalb nicht — Tailwind erzeugt sie stillschweigend nicht,
 * und der Knopf hat dann keinen Innenabstand. Dieser Test findet solche
 * Klassen in den Komponenten, bevor jemand sie im Browser sucht.
 */
const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const allowed = new Set<string>([...Object.keys(space), 'auto', 'full', 'screen', 'fit', 'min', 'max']);
const prefixes =
  '(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|space-x|space-y|top|bottom|left|right|inset|inset-x|inset-y|h|w|min-h|size|translate-x|translate-y|scroll-mt)';
const pattern = new RegExp(`(?<![\\w\\[-])-?${prefixes}-(\\d+(?:\\.\\d+)?)(?![\\w\\]])`, 'g');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.startsWith('tokens') ? [path] : [];
  });
}

it('benutzt nur Abstaende aus der Token-Skala', () => {
  const found: string[] = [];
  for (const file of files(srcRoot)) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        for (const match of line.matchAll(pattern)) {
          if (!allowed.has(match[1]!)) found.push(`${relative(srcRoot, file)}:${index + 1} ${match[0]}`);
        }
      });
  }
  expect(found, `Nicht in der Skala:\n${found.join('\n')}`).toEqual([]);
});
