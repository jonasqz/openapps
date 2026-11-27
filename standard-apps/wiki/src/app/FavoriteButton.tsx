'use client';

import { useState } from 'react';
import type { JSX } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@openapps/ui';
import { setFavoriteAction } from './actions';

/**
 * Favorit an- und abschalten. Ruft dieselbe Funktion wie das Tool
 * `favorites.set`; der Favorit gehoert der angemeldeten Person.
 */
export function FavoriteButton({ id, favorite }: { id: string; favorite: boolean }): JSX.Element {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | undefined>(undefined);

  const toggle = async (): Promise<void> => {
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await setFavoriteAction({ id, favorite: !favorite });
      if (result.ok) {
        router.refresh();
        return;
      }
      setMessage(result.formError ?? 'Could not change the favorite.');
    } catch {
      setMessage('Could not change the favorite. Please try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex flex-col gap-1">
      <Button variant="secondary" aria-pressed={favorite} loading={busy} onClick={() => void toggle()}>
        {favorite ? 'Remove favorite' : 'Add to favorites'}
      </Button>
      {message === undefined ? null : (
        <span role="alert" className="text-xs font-medium text-danger">
          {message}
        </span>
      )}
    </span>
  );
}
