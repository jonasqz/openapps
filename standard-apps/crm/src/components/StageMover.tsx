'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState, type JSX } from 'react';
import { Button, Dialog, Select, Textarea, useToast, type SelectOption } from '@openapps/ui';
import { moveDealAction } from '@/app/actions';
import { isClosedStage, needsReason, STAGE_LABELS, STAGES, type Stage } from '@/lib/domain';

/**
 * Stage-Wechsel aus der UI, fuer Board und Detailseite. Ruft das Tool
 * `deals.update_stage` (ueber `moveDealAction`); die Regeln stehen in
 * src/lib/stages.ts und gelten dort fuer Agents genauso.
 *
 * - Won und lost fragen im Dialog nach dem Grund, bevor etwas gespeichert wird.
 * - Nach dem Wechsel kommt ein Toast mit "Undo". Undo ist derselbe Tool-Aufruf
 *   zurueck; ein frueherer Grund geht dabei wieder mit.
 */

export interface MovableDeal {
  id: string;
  title: string;
  stage: Stage;
  closeReason: string | null;
}

const MAX_REASON = 2000;
/** Fuer Altbestand ohne Grund: Undo zurueck nach won/lost braucht einen. */
const UNDO_REASON = 'Restored with undo.';

export const STAGE_OPTIONS: SelectOption[] = STAGES.map((stage) => ({
  value: stage,
  label: STAGE_LABELS[stage],
}));

interface Pending {
  deal: MovableDeal;
  to: Stage;
}

/**
 * Liefert `move` und den Dialog, der dafuer gerendert werden muss.
 * `onLocalMove` erlaubt dem Board, die Karte sofort umzusetzen; bei einem
 * Fehler wird sie zurueckgesetzt.
 */
export function useStageMover(onLocalMove?: (dealId: string, stage: Stage) => void): {
  move: (deal: MovableDeal, to: Stage) => void;
  dialog: JSX.Element;
} {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  const save = useCallback(
    async (deal: MovableDeal, to: Stage, note: string, isUndo: boolean): Promise<boolean> => {
      onLocalMove?.(deal.id, to);
      let result: Awaited<ReturnType<typeof moveDealAction>>;
      try {
        result = await moveDealAction(deal.id, to, note);
      } catch {
        result = { ok: false, message: 'No connection to the server. Check your connection and try again.' };
      }
      if (!result.ok) {
        onLocalMove?.(deal.id, deal.stage);
        toast.show({ tone: 'danger', title: `${deal.title} was not moved`, description: result.message });
        return false;
      }
      router.refresh();
      if (result.changed && !isUndo) {
        const back: MovableDeal = { ...deal, stage: to, closeReason: needsReason(to) ? note : null };
        const undoNote = isClosedStage(deal.stage) ? (deal.closeReason ?? UNDO_REASON) : '';
        toast.show({
          tone: 'success',
          title: `Moved to ${STAGE_LABELS[to]}`,
          description: deal.title,
          action: { label: 'Undo', onClick: () => void save(back, deal.stage, undoNote, true) },
        });
      }
      return true;
    },
    [onLocalMove, router, toast],
  );

  const move = useCallback(
    (deal: MovableDeal, to: Stage): void => {
      if (deal.stage === to) return;
      if (needsReason(to)) {
        setPending({ deal, to });
        setReason('');
        setReasonError(undefined);
        return;
      }
      void save(deal, to, '', false);
    },
    [save],
  );

  const close = useCallback(() => {
    if (!saving) setPending(null);
  }, [saving]);

  const confirm = async (): Promise<void> => {
    if (pending === null) return;
    const text = reason.trim();
    if (text === '') {
      setReasonError('Enter the reason. It is stored on the deal and shown in the timeline.');
      return;
    }
    if (text.length > MAX_REASON) {
      setReasonError(`At most ${MAX_REASON} characters.`);
      return;
    }
    setSaving(true);
    const ok = await save(pending.deal, pending.to, text, false);
    setSaving(false);
    if (ok) setPending(null);
  };

  const won = pending?.to === 'won';
  const dialog = (
    <Dialog
      open={pending !== null}
      onClose={close}
      title={won ? 'Mark as won' : 'Mark as lost'}
      {...(pending === null ? {} : { description: pending.deal.title })}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant={won ? 'primary' : 'danger'}
            loading={saving}
            loadingLabel="Saving"
            onClick={() => void confirm()}
          >
            {won ? 'Mark as won' : 'Mark as lost'}
          </Button>
        </>
      }
    >
      <Textarea
        label={won ? 'Why did we win?' : 'Why did we lose?'}
        hint="Required. Agents and colleagues read this later."
        rows={4}
        maxLength={MAX_REASON}
        value={reason}
        onChange={(event) => {
          setReason(event.target.value);
          if (reasonError !== undefined && event.target.value.trim() !== '') setReasonError(undefined);
        }}
        required
        {...(reasonError === undefined ? {} : { error: reasonError })}
      />
    </Dialog>
  );

  return { move, dialog };
}

/** Auswahl "Stage" an einer Karte oder im Seitenkopf. Tastaturweg zum Ziehen. */
export function StageSelect({
  deal,
  onMove,
  label = 'Stage',
  hideLabel = true,
}: {
  deal: MovableDeal;
  onMove: (deal: MovableDeal, to: Stage) => void;
  label?: string;
  hideLabel?: boolean;
}): JSX.Element {
  return (
    <Select
      label={`${label} of ${deal.title}`}
      hideLabel={hideLabel}
      options={STAGE_OPTIONS}
      value={deal.stage}
      onChange={(event) => onMove(deal, event.target.value as Stage)}
    />
  );
}

/** Stage-Auswahl samt Dialog, fuer die Detailseite eines Deals. */
export function DealStageControl({ deal }: { deal: MovableDeal }): JSX.Element {
  const { move, dialog } = useStageMover();
  return (
    <div className="w-full min-w-0 sm:w-menu">
      <StageSelect deal={deal} onMove={move} />
      {dialog}
    </div>
  );
}
