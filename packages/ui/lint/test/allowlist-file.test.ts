import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Linter } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import { afterEach, describe, expect, it } from 'vitest';
import { clearAllowlistCache, plugin } from '../rules/index.js';

/**
 * `no-foreign-ui` liest zusätzlich erlaubte Pakete aus einer Datei, die die
 * Control Plane pflegt. Diese Tests decken die vier Fälle ab, die zählen:
 * Datei da, Datei kaputt, Datei fehlt, Objekt- statt Listenform.
 */
const dirs: string[] = [];

function projectWith(content: string | null, fileName = 'allowed-packages.json'): string {
  const dir = mkdtempSync(join(tmpdir(), 'oa-allowlist-'));
  dirs.push(dir);
  if (content !== null) writeFileSync(join(dir, fileName), content, 'utf8');
  return dir;
}

function lint(cwd: string, code: string, options: Record<string, unknown> = {}): Linter.LintMessage[] {
  clearAllowlistCache();
  // Eigener Linter je Projekt: `cwd` ist das Wurzelverzeichnis, gegen das die
  // Regel `allowed-packages.json` auflöst.
  const linter = new Linter({ configType: 'flat', cwd });
  return linter.verify(
    code,
    [
      {
        files: ['**/*.tsx'],
        plugins: { '@openapps/ui': plugin },
        languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
        rules: { '@openapps/ui/no-foreign-ui': ['error', options] },
      },
    ] as never,
    join(cwd, 'app.tsx'),
  );
}

afterEach(() => {
  clearAllowlistCache();
});

describe('no-foreign-ui liest allowed-packages.json', () => {
  it('erlaubt ein Paket, das in der Datei steht', () => {
    const cwd = projectWith('["zod", "date-fns"]');
    expect(lint(cwd, 'import { z } from "zod";')).toHaveLength(0);
    expect(lint(cwd, 'import { format } from "date-fns";')).toHaveLength(0);
  });

  it('versteht auch die Objektform mit "allow"', () => {
    const cwd = projectWith('{ "_kommentar": "von der Control Plane", "allow": ["zod"] }');
    expect(lint(cwd, 'import { z } from "zod";')).toHaveLength(0);
  });

  it('bleibt streng, wenn die Datei fehlt — nie „dann alles erlauben"', () => {
    const cwd = projectWith(null);
    const messages = lint(cwd, 'import { z } from "zod";');
    expect(messages).toHaveLength(1);
    expect(messages[0]?.messageId).toBe('foreign');
  });

  it('bleibt streng und meldet den Fehler, wenn die Datei kaputt ist', () => {
    const cwd = projectWith('{ das ist kein JSON');
    const messages = lint(cwd, 'import { z } from "zod";');
    expect(messages.map((m) => m.messageId)).toEqual(['badAllowlist', 'foreign']);
  });

  it('bleibt streng, wenn die Datei das falsche Format hat', () => {
    const cwd = projectWith('{ "allow": "zod" }');
    const messages = lint(cwd, 'import { z } from "zod";');
    expect(messages.map((m) => m.messageId)).toEqual(['badAllowlist', 'foreign']);
  });

  it('blockt weiterhin, was nicht in der Datei steht', () => {
    const cwd = projectWith('["zod"]');
    expect(lint(cwd, 'import { Button } from "@mui/material";')).toHaveLength(1);
  });

  it('nimmt einen eigenen Dateinamen über allowExtraFile', () => {
    const cwd = projectWith('["zod"]', 'freigegebene-pakete.json');
    expect(lint(cwd, 'import { z } from "zod";', { allowExtraFile: 'freigegebene-pakete.json' })).toHaveLength(0);
    expect(lint(cwd, 'import { z } from "zod";')).toHaveLength(1);
  });

  it('liest die Datei gar nicht, wenn useAllowlistFile false ist', () => {
    const cwd = projectWith('["zod"]');
    expect(lint(cwd, 'import { z } from "zod";', { useAllowlistFile: false })).toHaveLength(1);
  });

  it('die mitgelieferte Beispieldatei erlaubt nichts zusätzlich', async () => {
    const example = await import('../allowed-packages.example.json', { with: { type: 'json' } });
    expect((example.default as { allow: string[] }).allow).toEqual([]);
  });
});

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});
