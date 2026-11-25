'use client';

import { useState } from 'react';
import type { JSX } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Dialog } from '@openapps/ui';
import { archivePageAction } from './actions';

/**
 * Archivieren mit Rueckfrage. Ruft dieselbe Funktion wie das Tool
 * `pages.archive`. Hat die Seite noch Unterseiten, kommt die Meldung des
 * Tools hier sichtbar an.
 */
export function ArchiveButton({ id, title }: { id: string; title: string }): JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | undefined>(undefined);

  const confirm = async (): Promise<void> => {
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await archivePageAction({ id });
      if (result.ok) {
        setOpen(false);
        router.push('/');
        router.refresh();
        return;
      }
      setMessage(result.formError ?? 'Archiving failed.');
    } catch {
      setMessage('Archiving failed. Please try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>
        Archive
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        role="alertdialog"
        size="sm"
        title="Archive page?"
        description={`“${title}” disappears from the list and search. Content and history are kept.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void confirm()}>
              Archive
            </Button>
          </>
        }
      >
        {message === undefined ? null : (
          <p role="alert" className="text-sm font-medium text-danger">
            {message}
          </p>
        )}
      </Dialog>
    </>
  );
}
