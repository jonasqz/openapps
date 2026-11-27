import { PageHeader } from '@openapps/ui';
import { DealsTable, type DealRow, type StageFilter } from '@/components/DealsTable';
import { ButtonLink } from '@/components/links';
import { listDeals, type Deal } from '@/lib/crm';
import { isClosedStage, isStage, STAGE_LABELS } from '@/lib/domain';
import { formatDate, formatEuro } from '@/lib/format';

export const dynamic = 'force-dynamic';

const toRow = (deal: Deal): DealRow => ({
  id: deal.id,
  title: deal.title,
  stage: deal.stage,
  stageLabel: STAGE_LABELS[deal.stage],
  companyId: deal.companyId,
  companyName: deal.companyName,
  contactName: deal.contactName ?? '',
  value: formatEuro(deal.valueCents),
  valueCents: deal.valueCents,
  close: isClosedStage(deal.stage)
    ? `Closed ${deal.closedAt === null ? '–' : formatDate(deal.closedAt.slice(0, 10))}`
    : formatDate(deal.expectedClose),
  owner: deal.owner ?? '',
  nextStep: deal.nextStep === null ? '' : `${deal.nextStep.title} · ${formatDate(deal.nextStep.dueOn)}`,
  overdue: deal.nextStep?.overdue === true,
});

/** `?stage=` aus der Adresse, sonst kein Filter. Unbekannte Werte zaehlen nicht. */
function stageFilter(raw: string | string[] | undefined): StageFilter {
  if (raw === 'open' || raw === 'closed') return raw;
  return isStage(raw) ? raw : '';
}

/** Alle Deals. Dieselbe Liste liefert das Tool `deals.list`. */
export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const initialStage = stageFilter((await searchParams).stage);
  let deals: Deal[] = [];
  let failed = false;
  try {
    deals = await listDeals({ limit: 200 });
  } catch (error) {
    console.error('[crm] load deals:', error);
    failed = true;
  }

  return (
    <>
      <PageHeader
        eyebrow="CRM"
        title="Deals"
        description="Every deal, open and closed. Search by title, company, owner or contact."
        actions={
          <>
            <ButtonLink href="/pipeline" variant="secondary">
              Board
            </ButtonLink>
            <ButtonLink href="/deals/new">New deal</ButtonLink>
          </>
        }
      />
      <DealsTable rows={deals.map(toRow)} failed={failed} initialStage={initialStage} />
    </>
  );
}
