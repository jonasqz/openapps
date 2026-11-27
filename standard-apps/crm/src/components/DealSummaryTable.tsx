import type { JSX, ReactNode } from 'react';
import { Badge, Table } from '@openapps/ui';
import type { Deal } from '@/lib/crm';
import { isClosedStage, STAGE_LABELS } from '@/lib/domain';
import { formatDate, formatEuro } from '@/lib/format';
import { TextLink } from './links';

interface Row {
  id: string;
  title: ReactNode;
  stage: ReactNode;
  value: string;
  close: string;
  next: ReactNode;
}

const toRow = (deal: Deal): Row => ({
  id: deal.id,
  title: <TextLink href={`/deals/${deal.id}`}>{deal.title}</TextLink>,
  stage: (
    <Badge tone={deal.stage === 'won' ? 'success' : deal.stage === 'lost' ? 'danger' : 'primary'}>
      {STAGE_LABELS[deal.stage]}
    </Badge>
  ),
  value: formatEuro(deal.valueCents),
  close: isClosedStage(deal.stage)
    ? `Closed ${deal.closedAt === null ? '–' : formatDate(deal.closedAt.slice(0, 10))}`
    : formatDate(deal.expectedClose),
  next:
    deal.nextStep === null ? (
      ''
    ) : (
      <span className="flex min-w-0 items-center gap-1">
        {deal.nextStep.overdue ? <Badge tone="danger">Overdue</Badge> : null}
        <span className="truncate">{`${deal.nextStep.title} · ${formatDate(deal.nextStep.dueOn)}`}</span>
      </span>
    ),
});

/** Deals einer Firma oder eines Kontakts, serverfaehig. */
export function DealSummaryTable({
  caption,
  deals,
  emptyAction,
  failed = false,
}: {
  caption: string;
  deals: readonly Deal[];
  emptyAction?: ReactNode;
  failed?: boolean;
}): JSX.Element {
  return (
    <Table<Row>
      caption={caption}
      rows={deals.map(toRow)}
      columns={[
        { field: 'title', header: 'Deal' },
        { field: 'stage', header: 'Stage' },
        { field: 'value', header: 'Value', align: 'right' },
        { field: 'close', header: 'Close', hideBelow: 'sm' },
        { field: 'next', header: 'Next step', hideBelow: 'md' },
      ]}
      empty={{
        title: 'No deals yet',
        description: 'Create a deal to track what this could be worth.',
        ...(emptyAction === undefined ? {} : { action: emptyAction }),
      }}
      error={failed ? { title: 'Deals could not be loaded', description: 'Reload the page.' } : undefined}
    />
  );
}
