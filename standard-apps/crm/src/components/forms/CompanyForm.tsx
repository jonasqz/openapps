'use client';

import { useRouter } from 'next/navigation';
import type { JSX } from 'react';
import { FormPattern } from '@openapps/ui';
import { createCompanyAction } from '@/app/actions';
import { useActionSubmit } from './useActionSubmit';

/** Neue Firma. Tool: `companies.create`. */
export function CompanyForm(): JSX.Element {
  const router = useRouter();
  const { onSubmit, formError } = useActionSubmit(createCompanyAction, (id) => `/companies/${id}`);

  return (
    <FormPattern
      title="New company"
      description="Name is required; you can add the rest later."
      columns={2}
      fields={[
        { name: 'name', label: 'Name', kind: 'text', required: true },
        {
          name: 'website',
          label: 'Website',
          kind: 'text',
          placeholder: 'https://example.com',
          hint: 'https:// is added if missing.',
        },
        { name: 'industry', label: 'Industry', kind: 'text' },
        { name: 'notes', label: 'Notes', kind: 'text' },
      ]}
      submitLabel="Create company"
      onCancel={() => router.back()}
      onSubmit={onSubmit}
      {...(formError === undefined ? {} : { formError })}
    />
  );
}
