import { ToolInputError } from '@openapps/sdk';
import { describe, expect, it } from 'vitest';
import { CLOSED_STAGES, isClosedStage, needsReason, OPEN_STAGES, STAGES } from './domain';
import { planStageChange, stageChangeSubject } from './stages';

/**
 * Phasenwechsel: die riskante Stelle der Pipeline. Ein Abschluss ohne Grund,
 * ein doppelter Eintrag bei gleicher Stage oder ein Grund, der beim
 * Wiedereroeffnen haengen bleibt, waeren stille Fehler im Verlauf.
 */
describe('planStageChange', () => {
  it('changes nothing when the stage stays the same, for every stage', () => {
    for (const stage of STAGES) {
      expect(planStageChange(stage, stage, undefined)).toEqual({ changed: false });
      expect(planStageChange(stage, stage, 'new reason')).toEqual({ changed: false });
    }
  });

  it('requires a reason for every move into won or lost', () => {
    for (const from of STAGES) {
      for (const to of CLOSED_STAGES) {
        if (from === to) continue;
        for (const note of [undefined, '', '   ']) {
          const error = (() => {
            try {
              planStageChange(from, to, note);
              return null;
            } catch (caught) {
              return caught;
            }
          })();
          expect(error, `${from} -> ${to} with ${JSON.stringify(note)}`).toBeInstanceOf(ToolInputError);
          expect((error as ToolInputError).issues).toEqual([
            expect.objectContaining({ path: ['note'] }),
          ]);
        }
      }
    }
  });

  it('stores the trimmed reason when closing', () => {
    const plan = planStageChange('proposal', 'lost', '  Chose a cheaper provider ');
    expect(plan).toEqual({
      changed: true,
      closeReason: 'Chose a cheaper provider',
      reopened: false,
      subject: 'Stage: Proposal → Lost',
    });
  });

  it('switches between won and lost with the new reason, not as a reopen', () => {
    expect(planStageChange('won', 'lost', 'Contract cancelled')).toMatchObject({
      changed: true,
      closeReason: 'Contract cancelled',
      reopened: false,
    });
  });

  it('clears the reason when a closed deal is reopened, and the note is optional', () => {
    for (const from of CLOSED_STAGES) {
      for (const to of OPEN_STAGES) {
        expect(planStageChange(from, to, undefined)).toMatchObject({
          changed: true,
          closeReason: null,
          reopened: true,
        });
      }
    }
  });

  it('moves freely between open stages without a reason', () => {
    for (const from of OPEN_STAGES) {
      for (const to of OPEN_STAGES) {
        if (from === to) continue;
        expect(planStageChange(from, to, undefined)).toMatchObject({
          changed: true,
          closeReason: null,
          reopened: false,
        });
      }
    }
  });

  it('names old and new stage in the activity subject', () => {
    expect(stageChangeSubject('lead', 'qualified')).toBe('Stage: Lead → Qualified');
  });
});

describe('open and closed stages', () => {
  it('splits the five stages without overlap', () => {
    expect([...OPEN_STAGES, ...CLOSED_STAGES].sort()).toEqual([...STAGES].sort());
    for (const stage of STAGES) {
      expect(isClosedStage(stage)).toBe(CLOSED_STAGES.includes(stage));
      expect(needsReason(stage)).toBe(isClosedStage(stage));
    }
  });
});
