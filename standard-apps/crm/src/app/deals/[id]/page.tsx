import { notFound } from 'next/navigation';
import { ToolNotFoundError } from '@openapps/sdk';
import { Badge, Card, CardBody, CardHeader, ErrorState, PageHeader } from '@openapps/ui';
import { AppLinks } from '@/components/AppLinks';
import { ButtonLink, TextLink } from '@/components/links';
import { NextStepList } from '@/components/NextStepList';
import { Properties } from '@/components/Properties';
import { DealStageControl } from '@/components/StageMover';
import { Timeline } from '@/components/Timeline';
import { getDeal, type DealDetail } from '@/lib/crm';
import { isClosedStage, STAGE_LABELS, STAGE_PROBABILITY } from '@/lib/domain';
import { formatDate, formatDateTime, formatDay, formatEuro } from '@/lib/format';
import { uuid } from '@/lib/schemas';
import { nextStepView } from '@/lib/views';

export const dynamic = 'force-dynamic';

/**
 * Ein Deal mit Stage, naechsten Schritten und Zeitleiste. Dieselben Daten
 * liefert das Tool `deals.get`; die Stage aendert `deals.update_stage`.
 */
export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const parsed = uuid.safeParse((await params).id);
  if (!parsed.success) notFound();

  let detail: DealDetail | null = null;
  try {
    detail = await getDeal(parsed.data);
  } catch (error) {
    if (error instanceof ToolNotFoundError) notFound();
    console.error('[crm] load deal:', error);
  }

  if (detail === null) {
    return (
      <AppLinks>
        <PageHeader breadcrumbs={[{ label: 'Deals', href: '/deals' }, { label: 'Deal' }]} title="Deal" />
        <ErrorState title="Deal could not be loaded" description="The database did not respond. Reload the page." />
      </AppLinks>
    );
  }

  const { deal, activities, nextSteps } = detail;
  const closed = isClosedStage(deal.stage);
  const refs = `deal=${deal.id}&company=${deal.companyId}${deal.contactId === null ? '' : `&contact=${deal.contactId}`}`;
  const openSteps = nextSteps.filter((step) => step.doneAt === null);

  return (
    <AppLinks>
      <PageHeader
        breadcrumbs={[
          { label: 'Deals', href: '/deals' },
          { label: deal.companyName, href: `/companies/${deal.companyId}` },
          { label: deal.title },
        ]}
        title={deal.title}
        meta={
          <>
            <Badge tone={deal.stage === 'won' ? 'success' : deal.stage === 'lost' ? 'danger' : 'primary'}>
              {STAGE_LABELS[deal.stage]}
            </Badge>
            <Badge>{formatEuro(deal.valueCents)}</Badge>
          </>
        }
        description={
          closed
            ? `Closed ${deal.closedAt === null ? '' : formatDateTime(deal.closedAt)}`
            : `Expected close ${formatDate(deal.expectedClose)} · ${STAGE_PROBABILITY[deal.stage]} % win probability`
        }
        actions={
          <>
            <ButtonLink href={`/deals/${deal.id}/edit`} variant="secondary">
              Edit
            </ButtonLink>
            <ButtonLink href={`/activities/new?${refs}`} variant="secondary">
              Log activity
            </ButtonLink>
            <ButtonLink href={`/next-steps/new?${refs}`}>Add next step</ButtonLink>
          </>
        }
      />

      <div className="grid min-w-0 gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          {closed ? (
            <Card>
              <CardHeader as="h2" title={deal.stage === 'won' ? 'Why we won' : 'Why we lost'} />
              <CardBody>
                <p className="whitespace-pre-line text-sm text-fg [overflow-wrap:anywhere]">
                  {deal.closeReason ?? 'No reason was recorded for this deal.'}
                </p>
              </CardBody>
            </Card>
          ) : null}
          <Card>
            <CardHeader
              as="h2"
              title="Next steps"
              description={openSteps.length === 0 ? 'Nothing planned.' : `${openSteps.length} open`}
            />
            <CardBody>
              <NextStepList
                steps={nextSteps.map((step) => nextStepView(step, 'deal'))}
                addHref={`/next-steps/new?${refs}`}
              />
            </CardBody>
          </Card>
          <section aria-labelledby="timeline" className="flex min-w-0 flex-col gap-3">
            <h2 id="timeline" className="text-base font-medium text-fg">
              Timeline
            </h2>
            <Timeline
              activities={activities}
              hide={['deal', 'company']}
              emptyAction={<TextLink href={`/activities/new?${refs}`}>Log activity</TextLink>}
            />
          </section>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader as="h2" title="Stage" description="Won and lost ask for the reason." />
            <CardBody>
              <DealStageControl
                deal={{ id: deal.id, title: deal.title, stage: deal.stage, closeReason: deal.closeReason }}
              />
            </CardBody>
          </Card>
          <Properties
            title="Details"
            items={[
              { label: 'Company', value: <TextLink href={`/companies/${deal.companyId}`}>{deal.companyName}</TextLink> },
              {
                label: 'Contact',
                value:
                  deal.contactId === null ? null : (
                    <TextLink href={`/contacts/${deal.contactId}`}>{deal.contactName ?? deal.contactId}</TextLink>
                  ),
              },
              { label: 'Value', value: formatEuro(deal.valueCents) },
              { label: 'Expected close', value: formatDate(deal.expectedClose) },
              { label: 'Owner', value: deal.owner },
              { label: 'Created', value: formatDay(deal.createdAt) },
              { label: 'Updated', value: formatDay(deal.updatedAt) },
            ]}
          />
        </div>
      </div>
    </AppLinks>
  );
}
