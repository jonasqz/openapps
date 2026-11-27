'use client';

import { useRouter } from 'next/navigation';
import { useState, type JSX } from 'react';
import { Button, Select, useToast } from '@openapps/ui';
import {
  completeTaskAction,
  setStatusAction,
  undoCompleteAction,
  type StatusResult,
} from '@/app/actions';
import { STATUS_LABELS, STATUSES, type Status } from '@/lib/workflow';

/**
 * Statuswechsel aus der Oberflaeche. Tools: `tasks.complete` und
 * `tasks.update` (Status, und fuer Undo mit `expectedStatus: done`).
 *
 * Nach "Erledigt" zeigt eine Meldung "Undo". Undo setzt den vorigen Status
 * nur zurueck, wenn die Aufgabe noch Done ist; die Meldungen kommen aus dem
 * `ToastProvider` der gemeinsamen Leiste (PlatformShell).
 */
function useStatusChange(task: { id: string; title: string }): {
  pending: boolean;
  change: (status: Status) => Promise<void>;
} {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);

  const failed = (description: string): void => {
    toast.show({ tone: 'danger', title: 'The task was not changed', description });
  };

  const undo = async (previousStatus: Status): Promise<void> => {
    try {
      const result = await undoCompleteAction(task.id, previousStatus);
      if (!result.ok) {
        // Die Tool-Meldung richtet sich an Agents (tasks.get); hier ein Satz fuer Menschen.
        failed(
          result.fieldErrors.expectedStatus !== undefined
            ? 'Someone changed the task in the meantime, so it was left as it is.'
            : (result.formError ?? 'Undo did not work.'),
        );
        router.refresh();
        return;
      }
      router.refresh();
      toast.show({ title: `Back to ${STATUS_LABELS[previousStatus]}`, description: task.title });
    } catch {
      failed('No connection to the server.');
    }
  };

  const change = async (status: Status): Promise<void> => {
    setPending(true);
    let result: StatusResult;
    try {
      result = status === 'done' ? await completeTaskAction(task.id) : await setStatusAction(task.id, status);
    } catch {
      setPending(false);
      failed('No connection to the server.');
      return;
    }
    setPending(false);
    if (!result.ok) {
      failed(result.formError ?? 'That did not work.');
      return;
    }
    router.refresh();
    if (!result.changed) return;
    const previousStatus = result.previousStatus;
    if (status === 'done') {
      toast.show({
        tone: 'success',
        title: 'Task completed',
        description: task.title,
        action: { label: 'Undo', onClick: () => void undo(previousStatus) },
      });
    } else {
      toast.show({ title: `Moved to ${STATUS_LABELS[status]}`, description: task.title });
    }
  };

  return { pending, change };
}

/** "Complete" in Listen. */
export function CompleteButton({ id, title }: { id: string; title: string }): JSX.Element {
  const { pending, change } = useStatusChange({ id, title });
  return (
    <Button
      variant="secondary"
      size="sm"
      loading={pending}
      aria-label={`Mark “${title}” as done`}
      onClick={() => void change('done')}
    >
      Complete
    </Button>
  );
}

/** Auf dem Board: zu den beiden anderen Spalten verschieben. */
export function MoveButtons({
  id,
  title,
  status,
}: {
  id: string;
  title: string;
  status: Status;
}): JSX.Element {
  const { pending, change } = useStatusChange({ id, title });
  const targets: { to: Status; label: string }[] =
    status === 'todo'
      ? [
          { to: 'in_progress', label: 'Start' },
          { to: 'done', label: 'Complete' },
        ]
      : status === 'in_progress'
        ? [
            { to: 'todo', label: 'Back to To do' },
            { to: 'done', label: 'Complete' },
          ]
        : [{ to: 'todo', label: 'Reopen' }];
  return (
    <div className="flex flex-wrap gap-2">
      {targets.map((target) => (
        <Button
          key={target.to}
          variant={target.to === 'done' ? 'secondary' : 'ghost'}
          size="sm"
          disabled={pending}
          aria-label={`${target.label}: “${title}”`}
          onClick={() => void change(target.to)}
        >
          {target.label}
        </Button>
      ))}
    </div>
  );
}

/** Auf der Detailseite: der Status als Auswahl. */
export function StatusSelect({
  id,
  title,
  status,
}: {
  id: string;
  title: string;
  status: Status;
}): JSX.Element {
  const { pending, change } = useStatusChange({ id, title });
  return (
    <Select
      label="Status"
      hideLabel
      value={status}
      disabled={pending}
      options={STATUSES.map((value) => ({ value, label: STATUS_LABELS[value] }))}
      onChange={(event) => {
        const next = event.target.value;
        if (next !== status && (STATUSES as readonly string[]).includes(next)) void change(next as Status);
      }}
    />
  );
}
