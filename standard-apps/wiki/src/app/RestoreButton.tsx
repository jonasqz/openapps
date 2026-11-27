'use client';

import { useState } from 'react';
import type { JSX } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Dialog } from '@openapps/ui';
import { restorePageAction } from './actions';

/**
 * Eine fruehere Version wiederherstellen, mit Rueckfrage. Ruft dieselbe
 * Funktion wie das Tool `pages.restore`; der Verlauf bleibt vollstaendig.
 */
export function RestoreButton({
  id,
  revisionId,
  when,
}: {
  id: string;
  revisionId: string;
  when: string;
}): JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | undefined>(undefined);

  const confirm = async (): Promise<void> => {
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await restorePageAction({ id, revisionId });
      if (result.ok) {
        setOpen(false);
        router.push(`/pages/${id}`);
        router.refresh();
        return;
      }
      setMessage(result.formError ?? 'Restoring failed.');
    } catch {
      setMessage('Restoring failed. Please try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Restore this version
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        role="alertdialog"
        size="sm"
        title="Restore this version?"
        description={`Title, content and tags go back to the state of ${when}. The current state stays in the history.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button loading={busy} onClick={() => void confirm()}>
              Restore
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
