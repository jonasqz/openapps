/**
 * UI-Linter — Platzhalter. Die Regeln liefert der UI-Agent
 * (docs/05-ui-guide.md: keine eigenen Farbwerte, keine zweite UI-Bibliothek,
 * leerer und Fehlerzustand pro Liste).
 *
 * Solange keine Regeln da sind, meldet der Schritt `skipped` — und nicht
 * `error`. Beides unterscheidet sich: `skipped` blockiert nicht, `error`
 * blockiert. Ein noch nicht gebauter Linter darf keinen Deploy verhindern,
 * ein kaputter schon.
 */

import type { Finding, ReviewInput, ReviewStep, StepResult } from '../types';

export const UI_LINT_STEP = 'ui-lint';

export interface UiLintRules {
  /** Liefert Befunde fuer die Arbeitskopie. Wird vom UI-Agent beigesteuert. */
  check(input: { repoDir: string }): Promise<readonly Finding[]>;
}

export function uiLintStep(rules?: UiLintRules): ReviewStep {
  return {
    name: UI_LINT_STEP,
    kind: 'deterministic',
    async run(input: ReviewInput): Promise<StepResult> {
      if (rules === undefined) {
        return {
          step: UI_LINT_STEP,
          kind: 'deterministic',
          findings: [],
          skipped: true,
        };
      }
      const findings = await rules.check({ repoDir: input.repoDir });
      return { step: UI_LINT_STEP, kind: 'deterministic', findings };
    },
  };
}
