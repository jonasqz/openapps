/**
 * Das Review-Gate, zusammengesetzt. Die Reihenfolge im Array ist nur die
 * Lesereihenfolge des Berichts — gelaufen wird parallel, und entschieden wird
 * in `mergeReview`.
 */

import { createPipeline } from './pipeline';
import { claudeReportStep } from './steps/claude-report';
import { gitleaksStep } from './steps/gitleaks';
import { manifestMatchStep } from './steps/manifest-match';
import { semgrepStep } from './steps/semgrep';
import { toolParityStep } from './steps/tool-parity';
import { uiLintStep, type UiLintRules } from './steps/ui-lint';
import type { ClaudeReviewer, ReviewPipeline, ScannerProcess } from './types';

export interface GateDependencies {
  readonly gitleaks: ScannerProcess;
  readonly semgrep: ScannerProcess;
  /** Kommt vom UI-Agent. Fehlt sie, wird der Schritt uebersprungen. */
  readonly uiLintRules?: UiLintRules;
  /** Fehlt er, laeuft das Gate ohne Claude-Report — es bleibt gueltig. */
  readonly claude?: ClaudeReviewer;
}

export function createDefaultPipeline(deps: GateDependencies): ReviewPipeline {
  return createPipeline([
    gitleaksStep(deps.gitleaks),
    semgrepStep(deps.semgrep),
    uiLintStep(deps.uiLintRules),
    toolParityStep(),
    manifestMatchStep(),
    claudeReportStep(deps.claude),
  ]);
}

export { createPipeline } from './pipeline';
export { mergeReview } from './merge';
export * from './types';
export { gitleaksStep, parseGitleaksReport, GITLEAKS_STEP } from './steps/gitleaks';
export { semgrepStep, parseSemgrepReport, SEMGREP_STEP } from './steps/semgrep';
export { uiLintStep, UI_LINT_STEP, type UiLintRules } from './steps/ui-lint';
export { toolParityStep, checkToolParity, TOOL_PARITY_STEP } from './steps/tool-parity';
export { manifestMatchStep, checkManifestMatch, MANIFEST_MATCH_STEP } from './steps/manifest-match';
export { claudeReportStep, CLAUDE_REPORT_STEP } from './steps/claude-report';
