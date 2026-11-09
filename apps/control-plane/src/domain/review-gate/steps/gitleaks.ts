/**
 * gitleaks — Secret-Scan. Deterministisch: jeder Fund blockiert (DoD 4).
 *
 * Der Prozessaufruf steckt hinter `ScannerProcess` und ist in v1 ein Stub.
 * Das Lesen des Berichts ist echt, weil genau daran haengt, ob ein
 * eingebautes Secret erkannt wird.
 */

import type { Finding, ReviewInput, ReviewStep, ScannerProcess, StepResult } from '../types';

export const GITLEAKS_STEP = 'gitleaks';

interface GitleaksRecord {
  readonly RuleID?: string;
  readonly Description?: string;
  readonly File?: string;
  readonly StartLine?: number;
}

export function gitleaksStep(process: ScannerProcess): ReviewStep {
  return {
    name: GITLEAKS_STEP,
    kind: 'deterministic',
    async run(input: ReviewInput): Promise<StepResult> {
      const output = await process.run({ repoDir: input.repoDir });
      const findings = parseGitleaksReport(output.stdout);

      // exitCode 0 = nichts gefunden, 1 = Funde. Alles andere heisst: der
      // Scanner selbst ist gescheitert, und das blockiert.
      if (output.exitCode !== 0 && output.exitCode !== 1) {
        return {
          step: GITLEAKS_STEP,
          kind: 'deterministic',
          findings,
          error: `gitleaks beendet mit Code ${output.exitCode}: ${output.stderr ?? ''}`.trim(),
        };
      }
      return { step: GITLEAKS_STEP, kind: 'deterministic', findings };
    },
  };
}

export function parseGitleaksReport(stdout: string): readonly Finding[] {
  const trimmed = stdout.trim();
  if (trimmed === '') return [];

  let records: unknown;
  try {
    records = JSON.parse(trimmed);
  } catch {
    // Unlesbarer Bericht ist ein Scanner-Fehler, kein "nichts gefunden".
    throw new Error('gitleaks-Bericht ist kein gueltiges JSON');
  }
  if (!Array.isArray(records)) {
    throw new Error('gitleaks-Bericht ist keine Liste');
  }

  return records.map((raw): Finding => {
    const record = raw as GitleaksRecord;
    const base = {
      step: GITLEAKS_STEP,
      // Jedes Secret blockiert. Es gibt keine Abstufung.
      severity: 'blocking' as const,
      code: `gitleaks.${record.RuleID ?? 'secret'}`,
      message: record.Description ?? 'Secret im Code gefunden',
    };
    return {
      ...base,
      ...(record.File === undefined ? {} : { path: record.File }),
      ...(record.StartLine === undefined ? {} : { line: record.StartLine }),
    };
  });
}
