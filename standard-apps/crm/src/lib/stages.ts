import { ToolInputError } from '@openapps/sdk';
import { isClosedStage, needsReason, REASON_REQUIRED, STAGE_LABELS, type Stage } from './domain';

/**
 * Die Regeln eines Stage-Wechsels als reine Funktion. `updateDealStage` in
 * src/lib/crm.ts fuehrt den Plan aus, das Board in der UI fragt vorher, ob ein
 * Grund noetig ist. Dieselben Regeln haelt migrations/0003_deal_close.sql in
 * der Datenbank fest (Trigger und Checks).
 */

export type StagePlan =
  | { changed: false }
  | {
      changed: true;
      /** Abschlussgrund, der am Deal steht; `null` bei offener Ziel-Stage. */
      closeReason: string | null;
      /** Wurde ein geschlossener Deal wieder geoeffnet? */
      reopened: boolean;
      /** Betreff der automatischen Aktivitaet. */
      subject: string;
    };

/** Text der automatischen Aktivitaet. */
export function stageChangeSubject(from: Stage, to: Stage): string {
  return `Stage: ${STAGE_LABELS[from]} → ${STAGE_LABELS[to]}`;
}

/**
 * Plant einen Wechsel von `from` nach `to`.
 *
 * - Gleiche Stage: nichts aendert sich, auch kein neuer Grund. Ein Aufrufer,
 *   der denselben Aufruf wiederholt, erzeugt so keinen zweiten Eintrag.
 * - Ziel won oder lost: `note` ist Pflicht und wird Abschlussgrund.
 * - Ziel offen: der Abschlussgrund faellt weg, `note` geht nur in den Verlauf.
 *
 * @throws ToolInputError, wenn ein Abschluss ohne Grund kommt.
 */
export function planStageChange(from: Stage, to: Stage, note: string | undefined): StagePlan {
  if (from === to) return { changed: false };
  const reason = note?.trim() ?? '';
  if (needsReason(to) && reason === '') {
    throw new ToolInputError(REASON_REQUIRED, [{ path: ['note'], message: REASON_REQUIRED }]);
  }
  return {
    changed: true,
    closeReason: needsReason(to) ? reason : null,
    reopened: isClosedStage(from) && !isClosedStage(to),
    subject: stageChangeSubject(from, to),
  };
}
