'use client';

import { useRouter } from 'next/navigation';
import type { JSX, ReactNode } from 'react';
import { Badge, Table, type TableColumn } from '@openapps/ui';
import { formatDate } from '@/lib/format';
import { PRIORITY_LABELS, STATUS_LABELS, type Priority, type Status } from '@/lib/workflow';
import { CompleteButton } from './StatusButtons';

/**
 * Die Aufgabentabelle fuer "My tasks" und "All tasks".
 *
 * Client-Komponente, weil die Zeile zur Detailseite fuehrt (`onRowActivate`)
 * und Zellen mit Knoepfen rechnen (`cell`). Die Suche der Tabelle durchsucht
 * nur Spalten mit `field` und Textwert — deshalb stehen Titel, Projekt,
 * Zuweisung und Prioritaet als Text in der Zeile. Status und Faelligkeit
 * tragen Badges und sind deshalb nicht durchsuchbar; dafuer gibt es Filter.
 */

/** Was die Server-Seite pro Aufgabe uebergibt. Nur Daten, keine Funktionen. */
export interface TaskRowData {
  id: string;
  title: string;
  status: Status;
  priority: Priority;
  assignee: string | null;
  dueDate: string | null;
  overdue: boolean;
  projectName: string | null;
}

interface Row extends TaskRowData {
  statusLabel: string;
  priorityLabel: string;
  project: string;
  assigneeText: string;
  due: string;
}

const STATUS_TONE: Record<Status, 'neutral' | 'primary' | 'success'> = {
  todo: 'neutral',
  in_progress: 'primary',
  done: 'success',
};

export function TaskTable({
  caption,
  tasks,
  hideAssignee = false,
  toolbar,
  empty,
  error,
}: {
  caption: string;
  tasks: readonly TaskRowData[];
  hideAssignee?: boolean;
  toolbar?: ReactNode;
  empty: { title: string; description?: string; action?: ReactNode };
  error?: { title: string; description?: string } | undefined;
}): JSX.Element {
  const router = useRouter();
  const rows: Row[] = tasks.map((task) => ({
    ...task,
    statusLabel: STATUS_LABELS[task.status],
    priorityLabel: PRIORITY_LABELS[task.priority],
    project: task.projectName ?? '',
    assigneeText: task.assignee ?? 'Unassigned',
    due: formatDate(task.dueDate),
  }));

  const columns: TableColumn<Row>[] = [
    { field: 'title', header: 'Title', className: 'w-2/5' },
    { field: 'project', header: 'Project', hideBelow: 'lg' },
    ...(hideAssignee ? [] : [{ field: 'assigneeText', header: 'Assignee', hideBelow: 'md' } as const]),
    {
      key: 'due',
      header: 'Due',
      hideBelow: 'sm',
      cell: (row) =>
        row.dueDate === null ? (
          <span className="text-fg-subtle">–</span>
        ) : (
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className={row.overdue ? 'font-medium text-danger' : undefined}>{row.due}</span>
            {row.overdue ? <Badge tone="danger">Overdue</Badge> : null}
          </span>
        ),
    },
    { field: 'priorityLabel', header: 'Priority', hideBelow: 'md' },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => <Badge tone={STATUS_TONE[row.status]}>{row.statusLabel}</Badge>,
    },
    {
      key: 'action',
      header: <span className="sr-only">Action</span>,
      className: 'w-[8rem]',
      cell: (row) => (row.status === 'done' ? null : <CompleteButton id={row.id} title={row.title} />),
    },
  ];

  return (
    <Table<Row>
      caption={caption}
      searchable
      rows={rows}
      columns={columns}
      onRowActivate={(row) => router.push(`/task/${row.id}`)}
      toolbar={toolbar}
      empty={empty}
      error={error}
    />
  );
}
