'use client';

import { useRouter } from 'next/navigation';
import { useState, type JSX } from 'react';
import { FormPattern, type FormValues } from '@openapps/ui';
import { createTaskAction } from '@/app/actions';

/** Neue Aufgabe. Tool: `tasks.create`. */
export function TaskForm(): JSX.Element {
  const router = useRouter();
  const [formError, setFormError] = useState<string | undefined>(undefined);

  const onSubmit = async (values: FormValues): Promise<Record<string, string> | undefined> => {
    setFormError(undefined);
    try {
      const result = await createTaskAction(values);
      if (result.ok) {
        router.push('/');
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
      title="New task"
      description="Title and assignee are required."
      columns={2}
      fields={[
        { name: 'title', label: 'Title', kind: 'text', required: true },
        { name: 'assignee', label: 'Assignee', kind: 'text', required: true },
        {
          name: 'dueDate',
          label: 'Due date',
          kind: 'text',
          placeholder: '2026-12-01',
          hint: 'Optional, as YYYY-MM-DD.',
          validate: (value) =>
            typeof value === 'string' &&
            value.trim() !== '' &&
            !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())
              ? 'Enter the date as YYYY-MM-DD.'
              : undefined,
        },
      ]}
      submitLabel="Create task"
      onCancel={() => router.back()}
      onSubmit={onSubmit}
      {...(formError === undefined ? {} : { formError })}
    />
  );
}
