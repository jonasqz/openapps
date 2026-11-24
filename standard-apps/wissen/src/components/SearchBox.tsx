'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useState, useTransition, type JSX } from 'react';
import { Button, Input } from '@openapps/ui';

/**
 * Suchfeld. Die Anfrage landet als `?q=` in der Adresse, die Seite sucht auf
 * dem Server — so ist jede Suche verlinkbar und das Zurueck im Browser geht.
 * Ein einzelnes Suchfeld ist kein Formular (UI-Guide), deshalb ohne `<form>`:
 * Enter und der Knopf loesen dieselbe Navigation aus.
 */
export function SearchBox({ initialQuery }: { initialQuery: string }): JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const [value, setValue] = useState(initialQuery);
  const [pending, startTransition] = useTransition();

  const submit = (): void => {
    const q = value.trim();
    startTransition(() => {
      router.push(q === '' ? pathname : `${pathname}?q=${encodeURIComponent(q)}`);
    });
  };

  return (
    <div role="search" className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <Input
        label="Frage oder Stichwörter"
        type="search"
        value={value}
        placeholder="z. B. Wie hoch ist die Kilometerpauschale?"
        maxLength={500}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            submit();
          }
        }}
        fieldClassName="min-w-0 flex-1"
      />
      <Button onClick={submit} loading={pending} loadingLabel="Suche läuft">
        Suchen
      </Button>
    </div>
  );
}
