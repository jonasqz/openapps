'use client';

import { useRouter } from 'next/navigation';
import { useState, type JSX } from 'react';
import { FormPattern, type FormValues } from '@openapps/ui';
import { createAufgabeAction } from '@/app/actions';

/** Neue Aufgabe. Tool: `aufgaben.create`. */
export function AufgabeForm(): JSX.Element {
  const router = useRouter();
  const [formError, setFormError] = useState<string | undefined>(undefined);

  const onSubmit = async (values: FormValues): Promise<Record<string, string> | undefined> => {
    setFormError(undefined);
    try {
      const result = await createAufgabeAction(values);
      if (result.ok) {
        router.push('/');
        router.refresh();
        return undefined;
      }
      if (result.formError !== undefined) setFormError(result.formError);
      return result.fieldErrors;
    } catch {
      setFormError('Keine Verbindung zum Server. Prüfe die Verbindung und versuche es erneut.');
      return undefined;
    }
  };

  return (
    <FormPattern
      title="Neue Aufgabe"
      description="Titel und zuständige Person sind Pflicht."
      columns={2}
      fields={[
        { name: 'titel', label: 'Titel', kind: 'text', required: true },
        { name: 'zustaendig', label: 'Zuständig', kind: 'text', required: true },
        {
          name: 'faelligAm',
          label: 'Fällig am',
          kind: 'text',
          placeholder: '2026-12-01',
          hint: 'Optional, als JJJJ-MM-TT.',
          validate: (value) =>
            typeof value === 'string' && value.trim() !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())
              ? 'Datum als JJJJ-MM-TT angeben.'
              : undefined,
        },
      ]}
      submitLabel="Aufgabe anlegen"
      onCancel={() => router.back()}
      onSubmit={onSubmit}
      {...(formError === undefined ? {} : { formError })}
    />
  );
}
