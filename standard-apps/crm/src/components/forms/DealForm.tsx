'use client';

import { useRouter } from 'next/navigation';
import type { JSX } from 'react';
import { FormPattern, type SelectOption } from '@openapps/ui';
import { createDealAction } from '@/app/actions';
import { OPEN_STAGES, STAGE_LABELS } from '@/lib/domain';
import { parseEuroToCents } from '@/lib/format';
import { useActionSubmit } from './useActionSubmit';

// Nur offene Stages: Abschluss mit Grund geht ueber deals.update_stage.
const STAGE_OPTIONS: SelectOption[] = OPEN_STAGES.map((stage) => ({
  value: stage,
  label: STAGE_LABELS[stage],
}));

/** Neuer Deal. Tool: `deals.create`. */
export function DealForm({
  companies,
  contacts,
  companyId,
}: {
  companies: readonly SelectOption[];
  contacts: readonly SelectOption[];
  companyId: string;
}): JSX.Element {
  const router = useRouter();
  const { onSubmit, formError } = useActionSubmit(createDealAction, (id) => `/deals/${id}`);

  return (
    <FormPattern
      title="New deal"
      description="The contact must belong to the selected company."
      columns={2}
      initialValues={{ companyId, stage: 'lead' }}
      fields={[
        { name: 'title', label: 'Title', kind: 'text', required: true },
        {
          name: 'companyId',
          label: 'Company',
          kind: 'select',
          options: companies,
          placeholder: 'Choose a company',
          required: true,
        },
        {
          name: 'contactId',
          label: 'Contact',
          kind: 'select',
          options: contacts,
          placeholder: 'No contact',
        },
        {
          name: 'value',
          label: 'Value in €',
          kind: 'text',
          placeholder: '12,500.00',
          required: true,
          validate: (value) =>
            typeof value === 'string' && value.trim() !== '' && parseEuroToCents(value) === null
              ? 'Enter an amount like 12,500 or 12,500.50.'
              : undefined,
        },
        {
          name: 'stage',
          label: 'Stage',
          kind: 'select',
          options: STAGE_OPTIONS,
          required: true,
          hint: 'New deals usually start as a lead. Won and lost are set later, with the reason.',
        },
        {
          name: 'expectedClose',
          label: 'Expected close',
          kind: 'text',
          placeholder: 'YYYY-MM-DD',
          validate: (value) =>
            typeof value === 'string' && value.trim() !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())
              ? 'Enter a date in the format YYYY-MM-DD.'
              : undefined,
        },
        {
          name: 'owner',
          label: 'Owner',
          kind: 'text',
          hint: 'Leave empty to make yourself the owner.',
        },
      ]}
      submitLabel="Create deal"
      onCancel={() => router.back()}
      onSubmit={onSubmit}
      {...(formError === undefined ? {} : { formError })}
    />
  );
}
