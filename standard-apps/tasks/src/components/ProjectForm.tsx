'use client';

import { useRouter } from 'next/navigation';
import { useState, type JSX } from 'react';
import { FormPattern, type FormValues } from '@openapps/ui';
import { createProjectAction } from '@/app/actions';

/** Neues Projekt. Tool: `projects.create`. */
export function ProjectForm(): JSX.Element {
  const router = useRouter();
  const [formError, setFormError] = useState<string | undefined>(undefined);

  const onSubmit = async (values: FormValues): Promise<Record<string, string> | undefined> => {
    setFormError(undefined);
    try {
      const result = await createProjectAction(values);
      if (result.ok) {
        router.push(`/all?project=${result.id}`);
        router.refresh();
        return undefined;
      }
      if (result.formError !== undefined) setFormError(result.formError);
      return result.fieldErrors;
    } catch {
      setFormError('No connection to the server. Check your connection and try again.');
      return undefined;
    }
  };

  return (
    <FormPattern
      title="New project"
      description="A project groups tasks. The name must be unique."
      fields={[
        {
          name: 'name',
          label: 'Name',
          kind: 'text',
          required: true,
          validate: (value) =>
            typeof value === 'string' && value.trim().length > 100
              ? 'Name can have at most 100 characters.'
              : undefined,
        },
        {
          name: 'description',
          label: 'Description',
          kind: 'text',
          hint: 'Optional, one line.',
          validate: (value) =>
            typeof value === 'string' && value.trim().length > 1000
              ? 'Description can have at most 1000 characters.'
              : undefined,
        },
      ]}
      submitLabel="Create project"
      onCancel={() => router.back()}
      onSubmit={onSubmit}
      {...(formError === undefined ? {} : { formError })}
    />
  );
}
