'use client';

import { useRouter } from 'next/navigation';
import type { JSX } from 'react';
import { FormPattern, type FormValues, type SelectOption } from '@openapps/ui';
import { logActivityAction } from '@/app/actions';
import { ACTIVITY_KIND_LABELS, ACTIVITY_KINDS } from '@/lib/domain';
import { text, useActionSubmit } from './useActionSubmit';

const KIND_OPTIONS: SelectOption[] = ACTIVITY_KINDS.map((kind) => ({
  value: kind,
  label: ACTIVITY_KIND_LABELS[kind],
}));

const NEEDS_REFERENCE = 'Choose a company, contact or deal — at least one of them.';

/** Aktivitaet erfassen. Tool: `activities.log`. */
export function ActivityForm({
  companies,
  contacts,
  deals,
  companyOf,
  initial,
}: {
  companies: readonly SelectOption[];
  contacts: readonly SelectOption[];
  deals: readonly SelectOption[];
  /** Firma je Kontakt- oder Deal-Id, fuer das Ziel nach dem Speichern. */
  companyOf: Readonly<Record<string, string>>;
  initial: { companyId: string; contactId: string; dealId: string };
}): JSX.Element {
  const router = useRouter();
  const { onSubmit, formError } = useActionSubmit(logActivityAction, (_id, values) => {
    const firma =
      text(values, 'companyId') ||
      companyOf[text(values, 'dealId')] ||
      companyOf[text(values, 'contactId')] ||
      '';
    return firma === '' ? '/' : `/companies/${firma}`;
  });

  const needsReference = (_value: string | boolean, values: FormValues): string | undefined =>
    text(values, 'companyId') === '' && text(values, 'contactId') === '' && text(values, 'dealId') === ''
      ? NEEDS_REFERENCE
      : undefined;

  return (
    <FormPattern
      title="Log activity"
      description="A note, a call, an email or a meeting — for a company, a contact or a deal."
      columns={2}
      initialValues={{ kind: 'note', ...initial }}
      fields={[
        { name: 'kind', label: 'Type', kind: 'select', options: KIND_OPTIONS, required: true },
        { name: 'subject', label: 'Subject', kind: 'text', required: true },
        { name: 'body', label: 'Details', kind: 'text' },
        {
          name: 'companyId',
          label: 'Company',
          kind: 'select',
          options: companies,
          placeholder: 'No company',
          validate: needsReference,
        },
        {
          name: 'contactId',
          label: 'Contact',
          kind: 'select',
          options: contacts,
          placeholder: 'No contact',
        },
        { name: 'dealId', label: 'Deal', kind: 'select', options: deals, placeholder: 'No deal' },
      ]}
      submitLabel="Save activity"
      onCancel={() => router.back()}
      onSubmit={onSubmit}
      {...(formError === undefined ? {} : { formError })}
    />
  );
}
