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
      `${blockingFindings.length} blockierende Befund(e): ` +
        blockingFindings.map((f) => f.code).join(', '),
    );
  }
  for (const s of brokenDeterministic) {
    reasons.push(`Schritt ${s.step} ist gescheitert: ${s.error ?? 'unbekannt'}`);
  }
  if (ranDeterministic.length === 0) {
    reasons.push(
      'kein deterministischer Schritt ist gelaufen — ein Claude-Report allein gibt nicht frei',
    );
  }

  const decision = reasons.length === 0 ? 'pass' : 'blocked';

  const advisoryCount = steps
    .filter((s) => s.kind === 'advisory')
    .reduce((n, s) => n + s.findings.length, 0);

  const summary =
    decision === 'pass'
      ? `freigegeben: ${ranDeterministic.length} deterministische Pruefung(en) ohne blockierenden Befund` +
        (advisoryCount > 0 ? `, ${advisoryCount} Hinweis(e) aus dem Claude-Report` : '')
      : `blockiert: ${reasons.join('; ')}`;

  return { decision, steps, findings, blockingFindings, summary, ranAt };
}

function kindOf(steps: readonly StepResult[], stepName: string): string | undefined {
  return steps.find((s) => s.step === stepName)?.kind;
}
