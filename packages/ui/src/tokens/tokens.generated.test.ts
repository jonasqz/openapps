import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Tokens haben genau eine Quelle. Dieser Test beweist es: er erzeugt die
 * abgeleiteten Dateien neu und vergleicht sie mit den eingecheckten.
 */
it('tokens.css und tailwind/preset.js passen zu tokens.ts', () => {
  const cssBefore = readFileSync(resolve(pkgRoot, 'src/tokens/tokens.css'), 'utf8');
  const presetBefore = readFileSync(resolve(pkgRoot, 'tailwind/preset.js'), 'utf8');

  execFileSync(process.execPath, ['--experimental-strip-types', 'src/tokens/generate.ts'], {
    cwd: pkgRoot,
    stdio: 'pipe',
  });

  expect(readFileSync(resolve(pkgRoot, 'src/tokens/tokens.css'), 'utf8')).toBe(cssBefore);
  expect(readFileSync(resolve(pkgRoot, 'tailwind/preset.js'), 'utf8')).toBe(presetBefore);
});

it('tokens.css deckt hell, System-dunkel und beide erzwungenen Themes ab', () => {
  const css = readFileSync(resolve(pkgRoot, 'src/tokens/tokens.css'), 'utf8');
  expect(css).toContain('@media (prefers-color-scheme: dark)');
  expect(css).toContain(":root:not([data-theme='light'])");
  expect(css).toContain("[data-theme='dark']");
  expect(css).toContain("[data-theme='light']");
  expect(css).toContain(':focus-visible');
});
