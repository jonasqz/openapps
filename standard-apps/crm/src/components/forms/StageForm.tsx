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
      title="Change stage"
      description="Each change is added to the history as a note, together with the reason."
      initialValues={{ id: dealId }}
      fields={[
        {
          name: 'id',
          label: 'Deal',
          kind: 'select',
          options: deals,
          placeholder: 'Choose a deal',
          required: true,
        },
        {
          name: 'stage',
          label: 'New stage',
          kind: 'select',
          options: STAGE_OPTIONS,
          placeholder: 'Choose a stage',
          required: true,
        },
        { name: 'note', label: 'Reason', kind: 'text' },
      ]}
      submitLabel="Set stage"
      onCancel={() => router.back()}
      onSubmit={onSubmit}
      {...(formError === undefined ? {} : { formError })}
    />
  );
}
