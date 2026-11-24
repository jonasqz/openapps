'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState, type JSX } from 'react';
import { Button, Dialog } from '@openapps/ui';
import { deleteDocumentAction } from '@/app/actions';

/** Loeschen mit Rueckfrage, die UI zum Tool `documents.delete`. */
export function DeleteDocumentButton({ id, title }: { id: string; title: string }): JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const close = useCallback(() => {
    setOpen(false);
    setMessage(undefined);
  }, []);

  const confirm = async (): Promise<void> => {
    setPending(true);
    setMessage(undefined);
    try {
      const result = await deleteDocumentAction(id);
      if (result.ok) {
        router.push('/dokumente');
        router.refresh();
        return;
      }
      setMessage(result.message);
    } catch {
      setMessage('Das Dokument konnte nicht gelöscht werden. Versuche es gleich noch einmal.');
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>
        Löschen
      </Button>
      <Dialog
        open={open}
        onClose={close}
        role="alertdialog"
        size="sm"
        title="Dokument löschen?"
        description={`„${title}“ taucht danach weder in der Suche noch in der Dokumentliste auf.`}
        footer={
          <>
            <Button variant="secondary" onClick={close} disabled={pending}>
              Abbrechen
            </Button>
            <Button
              variant="danger"
              onClick={() => void confirm()}
              loading={pending}
              loadingLabel="Wird gelöscht"
            >
              Löschen
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
