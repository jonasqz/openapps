/**
 * Claude-Report — advisory, immer. Er laeuft zuletzt und kann weder freigeben
 * noch blockieren (Brief: "Ein Claude-Review ist kein Sicherheitsbeweis").
 *
 * Jeder Befund wird vor der Zusammenfuehrung auf hoechstens 'warning'
 * herabgestuft, damit ein formulierungsstarkes Modell das Gate nicht umgeht.
 */

import type { ClaudeReviewer, Finding, ReviewInput, ReviewStep, StepResult } from '../types';

export const CLAUDE_REPORT_STEP = 'claude-report';

export function claudeReportStep(reviewer?: ClaudeReviewer): ReviewStep {
  return {
    name: CLAUDE_REPORT_STEP,
    kind: 'advisory',
    async run(input: ReviewInput): Promise<StepResult> {
      if (reviewer === undefined) {
        return { step: CLAUDE_REPORT_STEP, kind: 'advisory', findings: [], skipped: true };
      }
      try {
        const report = await reviewer.review(input);
        return {
          step: CLAUDE_REPORT_STEP,
          kind: 'advisory',
          findings: report.findings.map(downgrade),
        };
      } catch (error) {
        // Ein gescheiterter advisory-Schritt blockiert nicht.
        return {
          step: CLAUDE_REPORT_STEP,
          kind: 'advisory',
          findings: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

function downgrade(finding: Finding): Finding {
  return finding.severity === 'blocking' ? { ...finding, severity: 'warning' } : finding;
}
