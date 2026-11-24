'use client';

import { useRouter } from 'next/navigation';
import type { JSX } from 'react';
import { FormPattern, type SelectOption } from '@openapps/ui';
import { createDealAction } from '@/app/actions';
import { STAGE_LABELS, STAGES } from '@/lib/domain';
import { parseEuroToCents } from '@/lib/format';
import { text, useActionSubmit } from './useActionSubmit';

const STAGE_OPTIONS: SelectOption[] = STAGES.map((stage) => ({
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
  const { onSubmit, formError } = useActionSubmit(
    createDealAction,
    (_id, values) => `/firmen/${text(values, 'companyId')}`,
  );

  return (
    <FormPattern
      title="Neuer Deal"
      description="Der Kontakt muss zur gewählten Firma gehören."
      columns={2}
      initialValues={{ companyId, stage: 'lead' }}
      fields={[
        { name: 'title', label: 'Titel', kind: 'text', required: true },
        {
          name: 'companyId',
          label: 'Firma',
          kind: 'select',
          options: companies,
          placeholder: 'Firma wählen',
          required: true,
        },
        {
          name: 'contactId',
          label: 'Kontakt',
          kind: 'select',
          options: contacts,
          placeholder: 'Kein Kontakt',
        },
        {
          name: 'value',
          label: 'Wert in €',
          kind: 'text',
          placeholder: '12.500,00',
          required: true,
          validate: (value) =>
            typeof value === 'string' && value.trim() !== '' && parseEuroToCents(value) === null
              ? 'Betrag wie 12.500 oder 12.500,50 eingeben.'
              : undefined,
        },
        { name: 'stage', label: 'Stage', kind: 'select', options: STAGE_OPTIONS, required: true },
        {
          name: 'expectedClose',
          label: 'Erwarteter Abschluss',
          kind: 'text',
          placeholder: 'JJJJ-MM-TT',
          validate: (value) =>
            typeof value === 'string' && value.trim() !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())
              ? 'Datum im Format JJJJ-MM-TT eingeben.'
              : undefined,
        },
        {
          name: 'owner',
          label: 'Verantwortlich',
          kind: 'text',
          hint: 'Leer lassen: Du bist verantwortlich.',
        },
      ]}
      submitLabel="Deal anlegen"
      onCancel={() => router.back()}
      onSubmit={onSubmit}
      {...(formError === undefined ? {} : { formError })}
    />
  );
}
