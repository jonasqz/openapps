/**
 * Das Review-Gate, zusammengesetzt. Die Reihenfolge im Array ist nur die
 * Lesereihenfolge des Berichts — gelaufen wird parallel, und entschieden wird
 * in `mergeReview`.
 */

import { createPipeline } from './pipeline';
import { appBasePathStep } from './steps/app-base-path';
import { claudeReportStep } from './steps/claude-report';
import { gatewayConfigStep } from './steps/gateway-config';
import { gitleaksStep } from './steps/gitleaks';
import { manifestMatchStep } from './steps/manifest-match';
import { semgrepStep } from './steps/semgrep';
import { toolParityStep } from './steps/tool-parity';
import { uiLintStep, type UiLintRules } from './steps/ui-lint';
import type { GatewaySettings } from '../context';
import type { ClaudeReviewer, ReviewPipeline, ScannerProcess } from './types';

export interface GateDependencies {
  readonly gitleaks: ScannerProcess;
  readonly semgrep: ScannerProcess;
  /**
   * Die Werte, mit denen die Gateway-Konfiguration erzeugt wird. Nicht
   * optional: Ohne sie gibt es keinen Deploy, der nachweislich hinter der
   * Forward-Auth landet (ADR 0008 — das Default-Deny liegt jetzt im
   * Generator).
   */
  readonly gatewaySettings: GatewaySettings;
  /** Das eine Docker-Netz aus Spec 3.3. Default `coolify`. */
  readonly gatewayNetwork?: string;
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
    gatewayConfigStep(
      deps.gatewaySettings,
      deps.gatewayNetwork === undefined ? {} : { gatewayNetwork: deps.gatewayNetwork },
    ),
    appBasePathStep(),
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
export {
  gatewayConfigStep,
  checkGatewayConfig,
  GATEWAY_CONFIG_STEP,
  type GatewayConfigStepOptions,
} from './steps/gateway-config';
export {
  appBasePathStep,
  checkAppBasePath,
  APP_BASE_PATH_STEP,
  BASE_PATH_ENV,
} from './steps/app-base-path';
export { toolParityStep, checkToolParity, TOOL_PARITY_STEP } from './steps/tool-parity';
export { manifestMatchStep, checkManifestMatch, MANIFEST_MATCH_STEP } from './steps/manifest-match';
export { claudeReportStep, CLAUDE_REPORT_STEP } from './steps/claude-report';
