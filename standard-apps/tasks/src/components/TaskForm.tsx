'use client';

import { useRouter } from 'next/navigation';
import { useState, type JSX } from 'react';
import { FormPattern, Textarea, type FormField, type FormValues } from '@openapps/ui';
import {
  createTaskAction,
  createTaskFromRefAction,
  editTaskAction,
  type ActionResult,
} from '@/app/actions';
import { TaskRefChip } from '@/components/Refs';
import { PRIORITIES, PRIORITY_LABELS, STATUS_LABELS, STATUSES } from '@/lib/workflow';

/**
 * Neue Aufgabe (Tool `tasks.create`) oder Aufgabe bearbeiten (Tool
 * `tasks.update`). Dieselben Felder, dieselbe Pruefung wie im Tool; der
 * Server prueft trotzdem noch einmal, denn nur er zaehlt.
 *
 * Die Beschreibung steht als `Textarea` unter den Feldern, weil `FormPattern`
 * kein mehrzeiliges Feld kennt. Ihr Fehler kommt vom Server und steht am Feld.
 */

const DESCRIPTION_MAX = 10000;

function dateError(value: string | boolean): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const text = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return 'Enter the date as YYYY-MM-DD, e.g. 2026-12-01.';
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text
    ? undefined
    : 'This date does not exist. Enter the date as YYYY-MM-DD.';
}

export interface TaskFormProps {
  mode: 'create' | 'edit';
  /** Nur beim Bearbeiten. */
  taskId?: string;
  projects: readonly { id: string; name: string }[];
  initialValues: FormValues;
  initialDescription: string;
  /**
   * Nur beim Anlegen aus einem Objekt einer anderen App (ADR 0023 E): dann
   * speichert das Formular ueber `tasks.create_from_ref`, und die Aufgabe
   * verweist als `derived` auf die Quelle.
   */
  sourceRef?: string;
}

export function TaskForm({
  mode,
  taskId,
  projects,
  initialValues,
  initialDescription,
  sourceRef,
}: TaskFormProps): JSX.Element {
  const router = useRouter();
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [description, setDescription] = useState(initialDescription);
  const [descriptionError, setDescriptionError] = useState<string | undefined>(undefined);

  const fields: FormField[] = [
    { name: 'title', label: 'Title', kind: 'text', required: true },
    {
      name: 'assignee',
      label: 'Assignee',
      kind: 'email',
      hint: 'Email address. Leave empty for unassigned.',
    },
    {
      name: 'dueDate',
      label: 'Due date',
      kind: 'text',
      placeholder: '2026-12-01',
      hint: 'Optional, as YYYY-MM-DD.',
      validate: dateError,
    },
    {
      name: 'priority',
      label: 'Priority',
      kind: 'select',
      options: PRIORITIES.map((value) => ({ value, label: PRIORITY_LABELS[value] })),
    },
    {
      name: 'status',
      label: 'Status',
      kind: 'select',
      options: STATUSES.map((value) => ({ value, label: STATUS_LABELS[value] })),
    },
    {
      name: 'projectId',
      label: 'Project',
      kind: 'select',
      options: [{ value: '', label: 'No project' }, ...projects.map((p) => ({ value: p.id, label: p.name }))],
    },
  ];

  const onSubmit = async (values: FormValues): Promise<Record<string, string> | undefined> => {
    setFormError(undefined);
    if (description.length > DESCRIPTION_MAX) {
      setDescriptionError(`Description can have at most ${DESCRIPTION_MAX} characters.`);
      return undefined;
    }
    setDescriptionError(undefined);
    const all = { ...values, description };
    let result: ActionResult;
    try {
      result =
        mode === 'edit' && taskId !== undefined
          ? await editTaskAction(taskId, all, { ...initialValues, description: initialDescription })
          : sourceRef !== undefined
            ? await createTaskFromRefAction(sourceRef, all)
            : await createTaskAction(all);
    } catch {
      setFormError('No connection to the server. Check your connection and try again.');
      return undefined;
    }
    if (result.ok) {
      router.push(`/task/${result.id}`);
      router.refresh();
      return undefined;
    }
    if (result.fieldErrors.description !== undefined) setDescriptionError(result.fieldErrors.description);
    if (result.formError !== undefined) setFormError(result.formError);
    return result.fieldErrors;
  };

  return (
    <FormPattern
      title={mode === 'edit' ? 'Edit task' : 'New task'}
      description={
        mode === 'edit'
          ? 'Every change shows up in the history of the task.'
          : 'Only the title is required. Agents can create the same tasks with tasks.create.'
      }
      columns={2}
      fields={fields}
      initialValues={initialValues}
      submitLabel={mode === 'edit' ? 'Save changes' : 'Create task'}
      onCancel={() => router.back()}
      onSubmit={onSubmit}
      {...(formError === undefined ? {} : { formError })}
    >
      {sourceRef === undefined ? null : (
        <p className="flex min-w-0 flex-wrap items-baseline gap-2 text-sm text-fg-muted">
          Created from <TaskRefChip value={sourceRef} />
        </p>
      )}
      <Textarea
        label="Description"
        rows={6}
        value={description}
        maxLength={DESCRIPTION_MAX}
        hint="Optional. Plain text; @{app:type:id} links to an item in another app."
        onChange={(event) => setDescription(event.target.value)}
        {...(descriptionError === undefined ? {} : { error: descriptionError })}
      />
    </FormPattern>
  );
}
