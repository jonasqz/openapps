import { PageHeader } from '@openapps/ui';
import { ButtonLink } from '@/components/links';
import { PipelineBoard, type BoardColumn, type BoardDeal } from '@/components/PipelineBoard';
import { listDeals, pipelineSummary, type Deal } from '@/lib/crm';
import { isClosedStage } from '@/lib/domain';
import { formatDate, formatEuro } from '@/lib/format';
import type { PipelineSummary } from '@/lib/pipeline';

export const dynamic = 'force-dynamic';

/** Wie viele zuletzt geschlossene Deals je Spalte won/lost zeigen. */
const CLOSED_PER_COLUMN = 10;

const toBoardDeal = (deal: Deal): BoardDeal => ({
  id: deal.id,
  title: deal.title,
  stage: deal.stage,
  closeReason: deal.closeReason,
  companyId: deal.companyId,
  companyName: deal.companyName,
  valueLabel: formatEuro(deal.valueCents),
  closeLabel: isClosedStage(deal.stage)
    ? `Closed ${deal.closedAt === null ? '–' : formatDate(deal.closedAt.slice(0, 10))}`
    : `Close ${formatDate(deal.expectedClose)}`,
  owner: deal.owner,
  nextStep:
    deal.nextStep === null
      ? null
      : { title: deal.nextStep.title, dueLabel: formatDate(deal.nextStep.dueOn), overdue: deal.nextStep.overdue },
});

/** Zuletzt geschlossen zuerst; Altbestand ohne Zeitpunkt ans Ende. */
const byClosedDesc = (a: Deal, b: Deal): number => (b.closedAt ?? '').localeCompare(a.closedAt ?? '');

/**
 * Pipeline als Board. Dieselben Daten liefern `deals.list` (status open und
 * closed) und `pipeline.summary`; verschoben wird mit `deals.update_stage`.
 */
export default async function PipelinePage() {
  let summary: PipelineSummary | null = null;
  let deals: Deal[] = [];
  try {
    const [loaded, open, closed] = await Promise.all([
      pipelineSummary(),
      listDeals({ status: 'open', limit: 200 }),
      listDeals({ status: 'closed', limit: 200 }),
    ]);
    summary = loaded;
    const recentClosed = ['won', 'lost'].flatMap((stage) =>
      closed.filter((deal) => deal.stage === stage).sort(byClosedDesc).slice(0, CLOSED_PER_COLUMN),
    );
    deals = [...open, ...recentClosed];
  } catch (error) {
    console.error('[crm] load pipeline:', error);
    summary = null;
  }

  const columns: BoardColumn[] =
    summary?.stages.map((stage) => ({
      stage: stage.stage,
      count: stage.count,
      sumLabel: formatEuro(stage.sumCents),
      probability: stage.probability,
      limited: isClosedStage(stage.stage) && stage.count > CLOSED_PER_COLUMN,
    })) ?? [];

  return (
    <>
      <PageHeader
        eyebrow="CRM"
        title="Pipeline"
        description="Drag a deal to another stage, or pick the stage on the card. Won and lost ask for the reason."
        actions={<ButtonLink href="/deals/new">New deal</ButtonLink>}
      />
      <PipelineBoard deals={deals.map(toBoardDeal)} columns={columns} failed={summary === null} />
    </>
  );
}
