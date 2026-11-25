'use client';

import { useRouter } from 'next/navigation';
import type { JSX } from 'react';
import { FormPattern, type SelectOption } from '@openapps/ui';
import { createContactAction } from '@/app/actions';
import { text, useActionSubmit } from './useActionSubmit';

/** Neuer Kontakt. Tool: `contacts.create`. */
export function ContactForm({
  companies,
  companyId,
}: {
  companies: readonly SelectOption[];
  companyId: string;
}): JSX.Element {
  const router = useRouter();
  const { onSubmit, formError } = useActionSubmit(createContactAction, (_id, values) => {
    const firma = text(values, 'companyId');
    return firma === '' ? '/contacts' : `/companies/${firma}`;
  });

  return (
    <FormPattern
      title="New contact"
      description="Each email address can only be used once."
      columns={2}
      initialValues={{ companyId }}
      fields={[
        { name: 'name', label: 'Name', kind: 'text', required: true },
        { name: 'email', label: 'Email', kind: 'email', placeholder: 'name@example.com' },
        { name: 'phone', label: 'Phone', kind: 'text', placeholder: '+44 20 7946 0000' },
        { name: 'role', label: 'Role', kind: 'text', placeholder: 'e.g. Procurement' },
        {
          name: 'companyId',
          label: 'Company',
          kind: 'select',
          options: companies,
          placeholder: 'No company',
        },
      ]}
      submitLabel="Create contact"
      onCancel={() => router.back()}
      onSubmit={onSubmit}
      {...(formError === undefined ? {} : { formError })}
    />
  );
}
