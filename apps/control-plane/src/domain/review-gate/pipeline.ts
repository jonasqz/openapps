/**
 * Die Pipeline laeuft alle Schritte, auch wenn einer scheitert. Nur so steht
 * im Review-Ergebnis, was tatsaechlich geprueft wurde — und nicht nur, woran
 * es zuerst abgebrochen ist.
 */

import { mergeReview } from './merge';
import type { ReviewInput, ReviewPipeline, ReviewResult, ReviewStep, StepResult } from './types';

export function createPipeline(steps: readonly ReviewStep[]): ReviewPipeline {
  return {
    steps,
    async run(input: ReviewInput): Promise<ReviewResult> {
      const results = await Promise.all(steps.map((step) => runStep(step, input)));
      return mergeReview(results, new Date().toISOString());
    },
  };
}

async function runStep(step: ReviewStep, input: ReviewInput): Promise<StepResult> {
  const started = Date.now();
  try {
    const result = await step.run(input);
    return { ...result, durationMs: Date.now() - started };
  } catch (error) {
    return {
      step: step.name,
      kind: step.kind,
      findings: [],
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - started,
    };
  }
}
