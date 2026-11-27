'use client';

import { useRouter } from 'next/navigation';
import type { JSX } from 'react';
import { FormPattern, type SelectOption } from '@openapps/ui';
import { updateDealAction } from '@/app/actions';
import type { Deal } from '@/lib/crm';
import { formatEuroInput, parseEuroToCents } from '@/lib/format';
import { useActionSubmit } from './useActionSubmit';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Deal bearbeiten. Tool: `deals.update`. Leere Felder leeren Abschlussdatum,
 * Besitzer und Kontakt; die Stage aendert sich hier nie.
 */
export function DealEditForm({
  deal,
  contacts,
}: {
  deal: Deal;
  /** Nur Kontakte der Firma des Deals. */
  contacts: readonly SelectOption[];
}): JSX.Element {
  const router = useRouter();
  const { onSubmit, formError } = useActionSubmit(updateDealAction, (id) => `/deals/${id}`);

  return (
    <FormPattern
      title={`Edit ${deal.title}`}
      description={`Deal with ${deal.companyName}. The stage changes on the deal page or the board.`}
      columns={2}
      initialValues={{
        title: deal.title,
        value: formatEuroInput(deal.valueCents),
        expectedClose: deal.expectedClose ?? '',
        owner: deal.owner ?? '',
        contactId: deal.contactId ?? '',
      }}
      fields={[
        { name: 'title', label: 'Title', kind: 'text', required: true },
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
          name: 'expectedClose',
          label: 'Expected close',
          kind: 'text',
          placeholder: 'YYYY-MM-DD',
          hint: 'Leave empty if there is no date yet.',
          validate: (value) =>
            typeof value === 'string' && value.trim() !== '' && !DATE.test(value.trim())
              ? 'Enter a date in the format YYYY-MM-DD.'
              : undefined,
        },
        { name: 'owner', label: 'Owner', kind: 'text', hint: 'User id, e.g. agent:sales. Empty clears it.' },
        {
          name: 'contactId',
          label: 'Contact',
          kind: 'select',
          options: [{ value: '', label: 'No contact' }, ...contacts],
        },
      ]}
      submitLabel="Save deal"
      onCancel={() => router.back()}
      onSubmit={(values) => onSubmit({ ...values, id: deal.id })}
      {...(formError === undefined ? {} : { formError })}
    />
  );
}
