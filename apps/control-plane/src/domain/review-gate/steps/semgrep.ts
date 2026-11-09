/**
 * semgrep — Sicherheits-Regelmenge. Deterministisch. ERROR und WARNING aus der
 * Sicherheits-Regelmenge blockieren; INFO ist ein Hinweis.
 */

import type { Finding, ReviewInput, ReviewStep, ScannerProcess, StepResult } from '../types';

export const SEMGREP_STEP = 'semgrep';

interface SemgrepResult {
  readonly check_id?: string;
  readonly path?: string;
  readonly start?: { readonly line?: number };
  readonly extra?: { readonly message?: string; readonly severity?: string };
}

export function semgrepStep(process: ScannerProcess): ReviewStep {
  return {
    name: SEMGREP_STEP,
    kind: 'deterministic',
    async run(input: ReviewInput): Promise<StepResult> {
      const output = await process.run({ repoDir: input.repoDir });
      const findings = parseSemgrepReport(output.stdout);
      // semgrep: 0 = sauber, 1 = Funde, >1 = Scanner-Fehler.
      if (output.exitCode !== 0 && output.exitCode !== 1) {
        return {
          step: SEMGREP_STEP,
          kind: 'deterministic',
          findings,
          error: `semgrep beendet mit Code ${output.exitCode}: ${output.stderr ?? ''}`.trim(),
        };
      }
      return { step: SEMGREP_STEP, kind: 'deterministic', findings };
    },
  };
}

export function parseSemgrepReport(stdout: string): readonly Finding[] {
  const trimmed = stdout.trim();
  if (trimmed === '') return [];

  let payload: unknown;
  try {
    payload = JSON.parse(trimmed);
  } catch {
    throw new Error('semgrep-Bericht ist kein gueltiges JSON');
  }

  const results = (payload as { results?: unknown }).results;
  if (!Array.isArray(results)) {
    throw new Error('semgrep-Bericht enthaelt kein results-Feld');
  }

  return results.map((raw): Finding => {
    const result = raw as SemgrepResult;
    const severity = (result.extra?.severity ?? 'ERROR').toUpperCase();
    const base = {
      step: SEMGREP_STEP,
      severity: severity === 'INFO' ? ('info' as const) : ('blocking' as const),
      code: `semgrep.${result.check_id ?? 'unknown'}`,
      message: result.extra?.message ?? 'semgrep-Befund',
    };
    return {
      ...base,
      ...(result.path === undefined ? {} : { path: result.path }),
      ...(result.start?.line === undefined ? {} : { line: result.start.line }),
    };
  });
}
