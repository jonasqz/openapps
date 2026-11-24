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

const NEEDS_REFERENCE = 'Firma, Kontakt oder Deal wählen — mindestens eines davon.';

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
    return firma === '' ? '/' : `/firmen/${firma}`;
  });

  const needsReference = (_value: string | boolean, values: FormValues): string | undefined =>
    text(values, 'companyId') === '' && text(values, 'contactId') === '' && text(values, 'dealId') === ''
      ? NEEDS_REFERENCE
      : undefined;

  return (
    <FormPattern
      title="Aktivität erfassen"
      description="Eine Notiz, ein Anruf, eine Mail oder ein Termin — zu einer Firma, einem Kontakt oder einem Deal."
      columns={2}
      initialValues={{ kind: 'notiz', ...initial }}
      fields={[
        { name: 'kind', label: 'Art', kind: 'select', options: KIND_OPTIONS, required: true },
        { name: 'subject', label: 'Betreff', kind: 'text', required: true },
        { name: 'body', label: 'Inhalt', kind: 'text' },
        {
          name: 'companyId',
          label: 'Firma',
          kind: 'select',
          options: companies,
          placeholder: 'Keine Firma',
          validate: needsReference,
        },
        {
          name: 'contactId',
          label: 'Kontakt',
          kind: 'select',
          options: contacts,
          placeholder: 'Kein Kontakt',
        },
        { name: 'dealId', label: 'Deal', kind: 'select', options: deals, placeholder: 'Kein Deal' },
      ]}
      submitLabel="Aktivität speichern"
      onCancel={() => router.back()}
      onSubmit={onSubmit}
      {...(formError === undefined ? {} : { formError })}
    />
  );
}
