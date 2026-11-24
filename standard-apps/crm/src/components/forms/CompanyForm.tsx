'use client';

import { useRouter } from 'next/navigation';
import type { JSX } from 'react';
import { FormPattern } from '@openapps/ui';
import { createCompanyAction } from '@/app/actions';
import { useActionSubmit } from './useActionSubmit';

/** Neue Firma. Tool: `companies.create`. */
export function CompanyForm(): JSX.Element {
  const router = useRouter();
  const { onSubmit, formError } = useActionSubmit(createCompanyAction, (id) => `/firmen/${id}`);

  return (
    <FormPattern
      title="Neue Firma"
      description="Name ist Pflicht, der Rest lässt sich später ergänzen."
      columns={2}
      fields={[
        { name: 'name', label: 'Name', kind: 'text', required: true },
        {
          name: 'website',
          label: 'Website',
          kind: 'text',
          placeholder: 'https://example.com',
          hint: 'Ohne https:// wird es ergänzt.',
        },
        { name: 'branche', label: 'Branche', kind: 'text' },
        { name: 'notes', label: 'Notizen', kind: 'text' },
      ]}
      submitLabel="Firma anlegen"
      onCancel={() => router.back()}
      onSubmit={onSubmit}
      {...(formError === undefined ? {} : { formError })}
    />
  );
}
