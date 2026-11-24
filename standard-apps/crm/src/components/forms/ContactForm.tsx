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
    return firma === '' ? '/kontakte' : `/firmen/${firma}`;
  });

  return (
    <FormPattern
      title="Neuer Kontakt"
      description="Die E-Mail-Adresse darf es nur einmal geben."
      columns={2}
      initialValues={{ companyId }}
      fields={[
        { name: 'name', label: 'Name', kind: 'text', required: true },
        { name: 'email', label: 'E-Mail', kind: 'email', placeholder: 'name@example.com' },
        { name: 'phone', label: 'Telefon', kind: 'text', placeholder: '+49 30 123456' },
        { name: 'role', label: 'Rolle', kind: 'text', placeholder: 'z. B. Einkauf' },
        {
          name: 'companyId',
          label: 'Firma',
          kind: 'select',
          options: companies,
          placeholder: 'Keine Firma',
        },
      ]}
      submitLabel="Kontakt anlegen"
      onCancel={() => router.back()}
      onSubmit={onSubmit}
      {...(formError === undefined ? {} : { formError })}
    />
  );
}
