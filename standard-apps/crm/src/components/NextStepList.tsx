'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type JSX, type ReactNode } from 'react';
import { Badge, Button, EmptyState, ErrorState, useToast } from '@openapps/ui';
import { completeNextStepAction, reopenNextStepAction } from '@/app/actions';

/** Ein Schritt, wie ihn die Server-Seite fertig aufbereitet (keine Funktionen). */
export interface NextStepView {
  id: string;
  title: string;
  /** Schon formatiert, z. B. "3 Dec 2026". */
  dueLabel: string;
  overdue: boolean;
  done: boolean;
  /** Woran der Schritt haengt, als Verweis; fehlt auf der eigenen Seite. */
  context?: { label: string; href: string };
  owner: string | null;
}

/**
 * Naechste Schritte mit "Done" und Undo. Erledigen ruft `next_steps.complete`,
 * das Undo im Toast `next_steps.reopen` — beides gibt es als Tool.
 */
export function NextStepList({
  steps,
  failed = false,
  addHref,
}: {
  steps: readonly NextStepView[];
  failed?: boolean;
  /** Wohin "Add next step" fuehrt, mit dem Bezug in der Adresse. */
  addHref?: string;
}): JSX.Element {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (
    id: string,
    action: (id: string) => Promise<{ ok: true; changed: boolean } | { ok: false; message: string }>,
  ): Promise<boolean> => {
    setBusy(id);
    try {
      const result = await action(id);
      if (!result.ok) {
        toast.show({ tone: 'danger', title: 'Not saved', description: result.message });
        return false;
      }
      router.refresh();
      return true;
    } catch {
      toast.show({ tone: 'danger', title: 'No connection', description: 'Check your connection and try again.' });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const complete = async (step: NextStepView): Promise<void> => {
    if (!(await run(step.id, completeNextStepAction))) return;
    toast.show({
      tone: 'success',
      title: 'Marked as done',
      description: step.title,
      action: { label: 'Undo', onClick: () => void run(step.id, reopenNextStepAction) },
    });
  };

  const add: ReactNode =
    addHref === undefined ? undefined : (
      <Link href={addHref} className="text-sm font-medium text-primary underline-offset-2 hover:underline">
        Add next step
      </Link>
    );

  if (failed) {
    return (
      <ErrorState title="Next steps could not be loaded" description="The database did not respond. Reload the page." />
    );
  }
  if (steps.length === 0) {
    return (
      <EmptyState
        title="No next step planned"
        description="Plan what happens next and by when, so nothing stalls."
        {...(add === undefined ? {} : { action: add })}
      />
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <ul className="flex min-w-0 flex-col divide-y divide-border">
        {steps.map((step) => (
          <li key={step.id} className="flex min-w-0 items-start gap-3 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0 flex-1">
              <p
                className={
                  step.done
                    ? 'text-sm text-fg-muted line-through [overflow-wrap:anywhere]'
                    : 'text-sm font-medium text-fg [overflow-wrap:anywhere]'
                }
              >
                {step.title}
              </p>
              <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
                {step.overdue ? (
                  <Badge tone="danger">{`Overdue · ${step.dueLabel}`}</Badge>
                ) : (
                  <span>{step.done ? `Was due ${step.dueLabel}` : `Due ${step.dueLabel}`}</span>
                )}
                {step.context === undefined ? null : (
                  <Link href={step.context.href} className="text-primary underline-offset-2 hover:underline">
                    {step.context.label}
                  </Link>
                )}
                {step.owner === null ? null : <span className="[overflow-wrap:anywhere]">{step.owner}</span>}
              </p>
            </div>
            {step.done ? (
              <Button
                size="sm"
                variant="ghost"
                loading={busy === step.id}
                onClick={() => void run(step.id, reopenNextStepAction)}
              >
                Reopen
              </Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                loading={busy === step.id}
                onClick={() => void complete(step)}
                aria-label={`Mark "${step.title}" as done`}
              >
                Done
              </Button>
            )}
          </li>
        ))}
      </ul>
      {add}
    </div>
  );
}
