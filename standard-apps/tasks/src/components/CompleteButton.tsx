'use client';

import { useRouter } from 'next/navigation';
import { useState, type JSX } from 'react';
import { Button } from '@openapps/ui';
import { completeTaskAction } from '@/app/actions';

/** Knopf in der Liste. Tool: `tasks.complete`. */
export function CompleteButton({ id, title }: { id: string; title: string }): JSX.Element {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const onClick = async (): Promise<void> => {
    setLoading(true);
    setError(undefined);
    try {
      const result = await completeTaskAction(id);
      if (result.ok) router.refresh();
      else setError(result.formError ?? 'That did not work.');
    } catch {
      setError('No connection to the server.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        variant="secondary"
        size="sm"
        loading={loading}
        aria-label={`Mark “${title}” as completed`}
        onClick={() => void onClick()}
      >
        Complete
      </Button>
      {error === undefined ? null : (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </span>
  );
}
