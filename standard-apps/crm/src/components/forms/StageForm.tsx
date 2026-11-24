'use client';

import { useRouter } from 'next/navigation';
import type { JSX } from 'react';
import { FormPattern, type SelectOption } from '@openapps/ui';
import { updateDealStageAction } from '@/app/actions';
import { STAGE_LABELS, STAGES } from '@/lib/domain';
import { useActionSubmit } from './useActionSubmit';

const STAGE_OPTIONS: SelectOption[] = STAGES.map((stage) => ({
  value: stage,
  label: STAGE_LABELS[stage],
}));

/** Stage eines Deals setzen. Tool: `deals.update_stage`. */
export function StageForm({
  deals,
  dealId,
}: {
  deals: readonly SelectOption[];
  dealId: string;
}): JSX.Element {
  const router = useRouter();
  const { onSubmit, formError } = useActionSubmit(updateDealStageAction, () => '/');

  return (
    <FormPattern
      title="Stage ändern"
      description="Ein Wechsel landet automatisch als Notiz im Verlauf, mit der Begründung."
      initialValues={{ id: dealId }}
      fields={[
        {
          name: 'id',
          label: 'Deal',
          kind: 'select',
          options: deals,
          placeholder: 'Deal wählen',
          required: true,
        },
        {
          name: 'stage',
          label: 'Neue Stage',
          kind: 'select',
          options: STAGE_OPTIONS,
          placeholder: 'Stage wählen',
          required: true,
        },
        { name: 'note', label: 'Begründung', kind: 'text' },
      ]}
      submitLabel="Stage setzen"
      onCancel={() => router.back()}
      onSubmit={onSubmit}
      {...(formError === undefined ? {} : { formError })}
    />
  );
}
