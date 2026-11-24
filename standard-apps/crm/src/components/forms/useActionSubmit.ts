'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { FormValues } from '@openapps/ui';
import type { ActionResult } from '@/app/actions';

/**
 * Verbindet ein `FormPattern` mit einer Server-Action: Feldfehler gehen an
 * die Felder zurueck, ein allgemeiner Fehler oben ins Formular, Erfolg fuehrt
 * zum Ziel. `router.push` rechnet den basePath selbst ein.
 */
export function useActionSubmit(
  action: (values: FormValues) => Promise<ActionResult>,
  target: (id: string, values: FormValues) => string,
): {
  onSubmit: (values: FormValues) => Promise<Record<string, string> | undefined>;
  formError: string | undefined;
} {
  const router = useRouter();
  const [formError, setFormError] = useState<string | undefined>(undefined);

  const onSubmit = async (values: FormValues): Promise<Record<string, string> | undefined> => {
    setFormError(undefined);
    let result: ActionResult;
    try {
      result = await action(values);
    } catch {
      setFormError('Keine Verbindung zum Server. Prüfe die Verbindung und versuche es erneut.');
      return undefined;
    }
    if (result.ok) {
      router.push(target(result.id, values));
      router.refresh();
      return undefined;
    }
    if (result.formError !== undefined) setFormError(result.formError);
    return result.fieldErrors;
  };

  return { onSubmit, formError };
}

/** Ein Wert aus den Formularwerten als Text. */
export function text(values: FormValues, name: string): string {
  const value = values[name];
  return typeof value === 'string' ? value.trim() : '';
}
