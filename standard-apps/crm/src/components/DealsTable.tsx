'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type JSX } from 'react';
import { Badge, Select, Table, type SelectOption } from '@openapps/ui';
import { isClosedStage, STAGE_LABELS, STAGES, type Stage } from '@/lib/domain';

/** Eine Zeile, fertig aufbereitet von der Server-Seite. */
export interface DealRow {
  id: string;
  title: string;
  stage: Stage;
  stageLabel: string;
  companyId: string;
  companyName: string;
  contactName: string;
  value: string;
  /** Sortierbar ohne Formatierung: Betrag in Cent. */
  valueCents: number;
  close: string;
  owner: string;
  nextStep: string;
  overdue: boolean;
}

/** Filterwert: eine Stage, alle offenen, alle geschlossenen oder alles. */
export type StageFilter = Stage | 'open' | 'closed' | '';

const STAGE_FILTER_OPTIONS: SelectOption[] = [
  { value: '', label: 'All stages' },
  { value: 'open', label: 'Open (lead, qualified, proposal)' },
  { value: 'closed', label: 'Closed (won, lost)' },
  ...STAGES.map((stage) => ({ value: stage, label: STAGE_LABELS[stage] })),
];

const STAGE_TONE: Readonly<Record<Stage, 'neutral' | 'primary' | 'success' | 'warning' | 'danger'>> = {
  lead: 'neutral',
  qualified: 'primary',
  proposal: 'warning',
  won: 'success',
  lost: 'danger',
};

function matchesStage(row: DealRow, filter: StageFilter): boolean {
  if (filter === '') return true;
  if (filter === 'open') return !isClosedStage(row.stage);
  if (filter === 'closed') return isClosedStage(row.stage);
  return row.stage === filter;
}

/**
 * Alle Deals als Tabelle: Freitextsuche ueber die Spalten, Filter nach Stage
 * und Besitzer. Dieselbe Abfrage fuer Agents: `deals.list` mit q, stage,
 * status und owner.
 */
export function DealsTable({
  rows,
  failed,
  initialStage,
}: {
  rows: readonly DealRow[];
  failed: boolean;
  initialStage: StageFilter;
}): JSX.Element {
  const router = useRouter();
  const [stage, setStage] = useState<StageFilter>(initialStage);
  const [owner, setOwner] = useState('');

  const owners = useMemo<SelectOption[]>(() => {
    const names = [...new Set(rows.map((row) => row.owner).filter((name) => name !== ''))].sort();
    return [{ value: '', label: 'All owners' }, ...names.map((name) => ({ value: name, label: name }))];
  }, [rows]);

  const visible = rows.filter((row) => matchesStage(row, stage) && (owner === '' || row.owner === owner));
  const filtered = stage !== '' || owner !== '';

  return (
    <Table<DealRow>
      caption="Deals"
      searchable
      toolbar={
        <>
          <Select
            label="Stage"
            hideLabel
            options={STAGE_FILTER_OPTIONS}
            value={stage}
            onChange={(event) => setStage(event.target.value as StageFilter)}
          />
          <Select
            label="Owner"
            hideLabel
            options={owners}
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
          />
        </>
      }
      rows={visible}
      // Die erste Zelle wird zum Knopf auf die Detailseite. Titel bleibt ein
      // `field`, weil die Suche der Tabelle nur solche Spalten liest.
      onRowActivate={(row) => router.push(`/deals/${row.id}`)}
      columns={[
        { field: 'title', header: 'Deal' },
        { field: 'companyName', header: 'Company', hideBelow: 'sm' },
        {
          key: 'stage',
          header: 'Stage',
          cell: (row) => <Badge tone={STAGE_TONE[row.stage]}>{row.stageLabel}</Badge>,
        },
        { field: 'value', header: 'Value', align: 'right' },
        { field: 'close', header: 'Close', hideBelow: 'md' },
        {
          key: 'nextStep',
          header: 'Next step',
          hideBelow: 'lg',
          cell: (row) =>
            row.nextStep === '' ? (
              '—'
            ) : (
              <span className="flex min-w-0 items-center gap-1">
                {row.overdue ? <Badge tone="danger">Overdue</Badge> : null}
                <span className="truncate" title={row.nextStep}>
                  {row.nextStep}
                </span>
              </span>
            ),
        },
        { field: 'owner', header: 'Owner', hideBelow: 'lg' },
        { field: 'contactName', header: 'Contact', hideBelow: 'lg' },
      ]}
      empty={
        filtered
          ? { title: 'No deals match', description: 'No deal matches the stage or owner filter.' }
          : {
              title: 'No deals yet',
              description: 'Create the first deal and it will show up here.',
              action: (
                <Link href="/deals/new" className="text-sm font-medium text-primary underline-offset-2 hover:underline">
                  New deal
                </Link>
              ),
            }
      }
      error={failed ? { title: 'Deals could not be loaded', description: 'The database did not respond. Reload the page.' } : undefined}
    />
  );
}
