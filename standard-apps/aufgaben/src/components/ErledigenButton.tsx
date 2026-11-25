'use client';

import { useRouter } from 'next/navigation';
import { useState, type JSX } from 'react';
import { Button } from '@openapps/ui';
import { erledigeAufgabeAction } from '@/app/actions';

/** Knopf in der Liste. Tool: `aufgaben.erledigen`. */
export function ErledigenButton({ id, titel }: { id: string; titel: string }): JSX.Element {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [fehler, setFehler] = useState<string | undefined>(undefined);

  const onClick = async (): Promise<void> => {
    setLoading(true);
    setFehler(undefined);
    try {
      const result = await erledigeAufgabeAction(id);
      if (result.ok) router.refresh();
      else setFehler(result.formError ?? 'Das hat nicht geklappt.');
    } catch {
      setFehler('Keine Verbindung zum Server.');
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
        aria-label={`„${titel}“ als erledigt markieren`}
        onClick={() => void onClick()}
      >
        Erledigt
      </Button>
      {fehler === undefined ? null : (
        <span role="alert" className="text-xs text-danger">
          {fehler}
        </span>
      )}
    </span>
  );
}
