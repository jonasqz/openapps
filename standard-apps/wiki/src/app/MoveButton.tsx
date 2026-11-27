'use client';

import { useState } from 'react';
import type { JSX } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Dialog, Select } from '@openapps/ui';
import type { FlatNode } from '@/lib/tree';
import { movePageAction } from './actions';

/** Wert der Auswahl fuer „oberste Ebene“; eine UUID kann nie so aussehen. */
const TOP = 'top';

/**
 * Seite verschieben, mit Auswahl der neuen Elternseite. `targets` kommt vom
 * Server und laesst die Seite selbst und ihre Unterseiten schon weg; ob das
 * Ziel wirklich keinen Kreis ergibt, prueft trotzdem `pages.move`.
 */
export function MoveButton({
  id,
  title,
  parentId,
  targets,
}: {
  id: string;
  title: string;
  parentId: string | null;
  targets: readonly FlatNode[];
}): JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<string>(parentId ?? TOP);
  const [message, setMessage] = useState<string | undefined>(undefined);

  const unchanged = target === (parentId ?? TOP);

  const confirm = async (): Promise<void> => {
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await movePageAction({ id, parentId: target === TOP ? null : target });
      if (result.ok) {
        setOpen(false);
        router.refresh();
        return;
      }
      setMessage(result.formError ?? 'Moving failed.');
    } catch {
      setMessage('Moving failed. Please try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  // Einrueckung im nativen <select> geht nur ueber Zeichen; Em-Abstaende
  // zeigen die Ebene, ohne den Titel zu veraendern.
  const options = [
    { value: TOP, label: 'Top level (no parent)' },
    ...targets.map((node) => ({
      value: node.id,
      label: `${' '.repeat(Math.min(node.depth + 1, 8))}${node.title}`,
    })),
  ];

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          setTarget(parentId ?? TOP);
          setMessage(undefined);
          setOpen(true);
        }}
      >
        Move
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        size="sm"
        title="Move page"
        description={`Choose the new parent for “${title}”. Its subpages move with it.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button loading={busy} disabled={unchanged} onClick={() => void confirm()}>
              Move
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Select
            label="New parent"
            options={options}
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            {...(message === undefined ? {} : { error: message })}
          />
        </div>
      </Dialog>
    </>
  );
}
