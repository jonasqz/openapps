'use client';

import { useRouter } from 'next/navigation';
import { useState, type JSX } from 'react';
import { Button, useToast } from '@openapps/ui';
import { assignToMeAction, unassignAction, type StatusResult } from '@/app/actions';

/**
 * Zuweisen an sich selbst oder Zuweisung aufheben. Tool: `tasks.assign`.
 * Die eigene Adresse setzt der Server aus `getUser`, nicht der Browser.
 */
export function AssignButtons({
  id,
  title,
  assignedToMe,
  assigned,
}: {
  id: string;
  title: string;
  assignedToMe: boolean;
  assigned: boolean;
}): JSX.Element {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);

  const run = async (action: () => Promise<StatusResult>, done: string): Promise<void> => {
    setPending(true);
    try {
      const result = await action();
      if (!result.ok) {
        toast.show({ tone: 'danger', title: 'The task was not changed', description: result.formError ?? '' });
        return;
      }
      router.refresh();
      if (result.changed) toast.show({ title: done, description: title });
    } catch {
      toast.show({ tone: 'danger', title: 'The task was not changed', description: 'No connection to the server.' });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      {assignedToMe ? null : (
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => void run(() => assignToMeAction(id), 'Assigned to you')}
        >
          Assign to me
        </Button>
      )}
      {assigned ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => void run(() => unassignAction(id), 'Unassigned')}
        >
          Unassign
        </Button>
      ) : null}
    </div>
  );
}
