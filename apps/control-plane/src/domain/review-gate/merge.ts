/**
 * Die Zusammenfuehrung. Dies ist die Stelle, die das Gate zum Gate macht —
 * sie ist absichtlich klein, vollstaendig synchron und ohne Abhaengigkeiten,
 * damit sie sich geradeaus testen laesst.
 */

import type { Finding, ReviewResult, StepResult } from './types';

export function mergeReview(steps: readonly StepResult[], ranAt: string): ReviewResult {
  const findings: Finding[] = steps.flatMap((s) => [...s.findings]);

  const blockingFindings = findings.filter(
    (f) => f.severity === 'blocking' && kindOf(steps, f.step) === 'deterministic',
  );

  // Ein deterministischer Schritt, der gescheitert ist, blockiert: "lief nicht"
  // ist kein gruenes Ergebnis.
  const brokenDeterministic = steps.filter(
    (s) => s.kind === 'deterministic' && s.error !== undefined,
  );

  // Ohne mindestens einen gelaufenen deterministischen Schritt gibt es keine
  // Freigabe. Ein Claude-Report allein kann nie freigeben.
  const ranDeterministic = steps.filter(
    (s) => s.kind === 'deterministic' && s.error === undefined && s.skipped !== true,
  );

  const reasons: string[] = [];
  if (blockingFindings.length > 0) {
    reasons.push(
      `${blockingFindings.length} blocking finding(s): ` +
        blockingFindings.map((f) => f.code).join(', '),
    );
  }
  for (const s of brokenDeterministic) {
    reasons.push(`step ${s.step} failed: ${s.error ?? 'unknown'}`);
  }
  if (ranDeterministic.length === 0) {
    reasons.push('no deterministic step ran; a Claude report alone does not approve');
  }

  const decision = reasons.length === 0 ? 'pass' : 'blocked';

  const advisoryCount = steps
    .filter((s) => s.kind === 'advisory')
    .reduce((n, s) => n + s.findings.length, 0);

  const summary =
    decision === 'pass'
      ? `approved: ${ranDeterministic.length} deterministic check(s) without a blocking finding` +
        (advisoryCount > 0 ? `, ${advisoryCount} note(s) from the Claude report` : '')
      : `blocked: ${reasons.join('; ')}`;

  return { decision, steps, findings, blockingFindings, summary, ranAt };
}

function kindOf(steps: readonly StepResult[], stepName: string): string | undefined {
  return steps.find((s) => s.step === stepName)?.kind;
}
