'use client';

import { useRouter } from 'next/navigation';
import type { JSX } from 'react';
import { FormPattern, type FormValues, type SelectOption } from '@openapps/ui';
import { createNextStepAction } from '@/app/actions';
import { text, useActionSubmit } from './useActionSubmit';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NEEDS_REFERENCE = 'Choose a deal, company or contact — at least one of them.';

/** Naechsten Schritt planen. Tool: `next_steps.create`. */
export function NextStepForm({
  companies,
  contacts,
  deals,
  initial,
  defaultDue,
}: {
  companies: readonly SelectOption[];
  contacts: readonly SelectOption[];
  deals: readonly SelectOption[];
  initial: { companyId: string; contactId: string; dealId: string };
  /** Vorschlag fuer die Faelligkeit, JJJJ-MM-TT, von der Server-Seite. */
  defaultDue: string;
}): JSX.Element {
  const router = useRouter();
  // Zurueck dorthin, woher man kam: Deal vor Kontakt vor Firma.
  const { onSubmit, formError } = useActionSubmit(createNextStepAction, (_id, values) => {
    if (text(values, 'dealId') !== '') return `/deals/${text(values, 'dealId')}`;
    if (text(values, 'contactId') !== '') return `/contacts/${text(values, 'contactId')}`;
    if (text(values, 'companyId') !== '') return `/companies/${text(values, 'companyId')}`;
    return '/';
  });

  const needsReference = (_value: string | boolean, values: FormValues): string | undefined =>
    text(values, 'companyId') === '' && text(values, 'contactId') === '' && text(values, 'dealId') === ''
      ? NEEDS_REFERENCE
      : undefined;

  return (
    <FormPattern
      title="Add next step"
      description="What happens next, and by when. Overdue steps show up on the overview."
      columns={2}
      initialValues={{ ...initial, dueOn: defaultDue }}
      fields={[
        { name: 'title', label: 'What', kind: 'text', required: true, placeholder: 'e.g. Send revised proposal' },
        {
          name: 'dueOn',
          label: 'Due',
          kind: 'text',
          required: true,
          placeholder: 'YYYY-MM-DD',
          validate: (value) =>
            typeof value === 'string' && value.trim() !== '' && !DATE.test(value.trim())
              ? 'Enter a date in the format YYYY-MM-DD.'
              : undefined,
        },
        { name: 'dealId', label: 'Deal', kind: 'select', options: deals, placeholder: 'No deal', validate: needsReference },
        { name: 'companyId', label: 'Company', kind: 'select', options: companies, placeholder: 'No company' },
        { name: 'contactId', label: 'Contact', kind: 'select', options: contacts, placeholder: 'No contact' },
        { name: 'owner', label: 'Owner', kind: 'text', hint: 'Leave empty to make yourself the owner.' },
      ]}
      submitLabel="Add next step"
      onCancel={() => router.back()}
      onSubmit={onSubmit}
      {...(formError === undefined ? {} : { formError })}
    />
  );
}
