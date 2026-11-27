'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useTransition, type JSX } from 'react';
import { Button, Checkbox, Select } from '@openapps/ui';
import { filtersToQuery, isFiltered, type FilterValues } from '@/lib/filters';
import { STATUS_LABELS, STATUSES } from '@/lib/workflow';

/**
 * Filter fuer Liste und Board. Sie stehen in der Adresse, damit ein Link
 * dieselbe Ansicht zeigt; gefiltert wird auf dem Server (tasks.list), nicht
 * im Browser. Die Suche der Tabelle filtert danach nur noch das Ergebnis.
 */
export function FilterBar({
  values,
  assignees,
  projects,
  showStatus = true,
}: {
  values: FilterValues;
  assignees: readonly string[];
  projects: readonly { id: string; name: string }[];
  showStatus?: boolean;
}): JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  const apply = (next: Partial<FilterValues>): void => {
    const query = filtersToQuery({ ...values, ...next });
    startTransition(() => router.replace(`${pathname}${query}`));
  };

  return (
    <div className="flex min-w-0 flex-wrap items-end gap-3" aria-busy={pending || undefined}>
      {showStatus ? (
        <Select
          label="Status"
          fieldClassName="w-40"
          value={values.status}
          options={[
            { value: '', label: 'Any status' },
            { value: 'open', label: 'Not done' },
            ...STATUSES.map((status) => ({ value: status, label: STATUS_LABELS[status] })),
          ]}
          onChange={(event) => {
            const status = event.target.value;
            if (status === '' || status === 'open' || (STATUSES as readonly string[]).includes(status)) {
              apply({ status: status as FilterValues['status'] });
            }
          }}
        />
      ) : null}
      <Select
        label="Assignee"
        fieldClassName="w-48"
        value={values.assignee}
        options={[
          { value: '', label: 'Anyone' },
          { value: 'me', label: 'Me' },
          { value: 'none', label: 'Unassigned' },
          ...assignees.map((email) => ({ value: email, label: email })),
        ]}
        onChange={(event) => apply({ assignee: event.target.value })}
      />
      <Select
        label="Project"
        fieldClassName="w-48"
        value={values.project}
        options={[
          { value: '', label: 'All projects' },
          ...projects.map((project) => ({ value: project.id, label: project.name })),
        ]}
        onChange={(event) => apply({ project: event.target.value })}
      />
      <div className="pb-2">
        <Checkbox
          label="Overdue only"
          checked={values.overdue}
          onChange={(event) => apply({ overdue: event.target.checked })}
        />
      </div>
      {isFiltered(values) ? (
        <div className="pb-0.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => apply({ status: '', assignee: '', project: '', overdue: false })}
          >
            Clear filters
          </Button>
        </div>
      ) : null}
    </div>
  );
}
