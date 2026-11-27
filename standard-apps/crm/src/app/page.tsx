import type { ReactNode } from 'react';
import { Card, CardBody, CardHeader, ErrorState, PageHeader, Stat, StatGroup, Table } from '@openapps/ui';
import { ButtonLink, TextLink } from '@/components/links';
import { NextStepList } from '@/components/NextStepList';
import { Timeline } from '@/components/Timeline';
import { listActivities, listNextSteps, pipelineSummary, type Activity, type NextStep } from '@/lib/crm';
import { STAGE_LABELS } from '@/lib/domain';
import { formatEuro } from '@/lib/format';
import type { PipelineSummary } from '@/lib/pipeline';
import { nextStepView } from '@/lib/views';

export const dynamic = 'force-dynamic';

/** Wie viele naechste Schritte und Aktivitaeten die Uebersicht zeigt. */
const STEP_LIMIT = 10;
const ACTIVITY_LIMIT = 8;

interface StageRow {
  id: string;
  stage: ReactNode;
  count: number;
  sum: string;
  probability: string;
  weighted: string;
}

/**
 * Uebersicht: offene Deals, Summe je Stage, ueberfaellige naechste Schritte,
 * letzte Aktivitaet. Dieselben Zahlen liefern `pipeline.summary`,
 * `next_steps.list` (status overdue/open) und `activities.list`.
 *
 * Jeder Block laedt fuer sich: faellt einer aus, zeigen die anderen weiter.
 */
export default async function OverviewPage() {
  const [summary, overdue, upcoming, activities] = await Promise.all([
    settle<PipelineSummary>('pipeline', pipelineSummary()),
    settle<NextStep[]>('overdue steps', listNextSteps({ status: 'overdue', limit: 200 })),
    settle<NextStep[]>('open steps', listNextSteps({ status: 'open', limit: 200 })),
    settle<Activity[]>('activities', listActivities({ limit: ACTIVITY_LIMIT })),
  ]);

  // Offen und noch nicht ueberfaellig; die ueberfaelligen stehen daneben.
  const comingUp = upcoming === null ? null : upcoming.filter((step) => !step.overdue).slice(0, STEP_LIMIT);

  const stageRows: StageRow[] =
    summary?.stages.map((stage) => ({
      id: stage.stage,
      stage: <TextLink href={`/deals?stage=${stage.stage}`}>{STAGE_LABELS[stage.stage]}</TextLink>,
      count: stage.count,
      sum: formatEuro(stage.sumCents),
      probability: `${stage.probability} %`,
      weighted: formatEuro(stage.weightedCents),
    })) ?? [];

  return (
    <>
      <PageHeader
        eyebrow="CRM"
        title="Overview"
        description="What is open, what it is worth, and what is late."
        actions={
          <>
            <ButtonLink href="/pipeline" variant="secondary">
              Open pipeline
            </ButtonLink>
            <ButtonLink href="/deals/new">New deal</ButtonLink>
          </>
        }
      />

      {summary === null ? (
        <ErrorState title="Key figures could not be loaded" description="The database did not respond. Reload the page." />
      ) : (
        <StatGroup>
          <Stat
            label="Open deals"
            value={summary.totals.openCount}
            hint={`${formatEuro(summary.totals.openSumCents)} in total`}
          />
          <Stat
            label="Weighted"
            value={formatEuro(summary.totals.weightedOpenCents)}
            hint="Open value × win probability"
          />
          <Stat label="Won" value={formatEuro(summary.totals.wonCents)} hint={`Lost: ${formatEuro(summary.totals.lostCents)}`} tone="success" />
          <Stat
            label="Overdue steps"
            value={overdue === null ? '–' : overdue.length}
            hint={overdue === null ? 'Not loaded' : overdue.length === 0 ? 'Nothing is late' : 'Due before today'}
            tone={overdue !== null && overdue.length > 0 ? 'danger' : 'neutral'}
          />
        </StatGroup>
      )}

      <div className="grid min-w-0 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            as="h2"
            title="Overdue"
            description="Open next steps that were due before today."
          />
          <CardBody>
            <NextStepList steps={(overdue ?? []).map((step) => nextStepView(step, 'overview'))} failed={overdue === null} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader as="h2" title="Coming up" description={`The next ${STEP_LIMIT} open steps by due date.`} />
          <CardBody>
            <NextStepList steps={(comingUp ?? []).map((step) => nextStepView(step, 'overview'))} failed={comingUp === null} />
          </CardBody>
        </Card>
      </div>

      <section aria-labelledby="by-stage" className="flex min-w-0 flex-col gap-3">
        <h2 id="by-stage" className="text-base font-medium text-fg">
          By stage
        </h2>
        <Table<StageRow>
          caption="Deals and value per stage"
          rows={stageRows}
          columns={[
            { field: 'stage', header: 'Stage' },
            { field: 'count', header: 'Deals', align: 'right' },
            { field: 'sum', header: 'Value', align: 'right' },
            { field: 'probability', header: 'Probability', align: 'right', hideBelow: 'sm' },
            { field: 'weighted', header: 'Weighted', align: 'right', hideBelow: 'sm' },
          ]}
          empty={{ title: 'No deals yet', description: 'Create the first deal and it will be counted here.' }}
          error={summary === null ? { title: 'Stages could not be loaded', description: 'Reload the page.' } : undefined}
        />
      </section>

      <section aria-labelledby="recent" className="flex min-w-0 flex-col gap-3">
        <h2 id="recent" className="text-base font-medium text-fg">
          Recent activity
        </h2>
        <Timeline activities={activities ?? []} failed={activities === null} />
      </section>
    </>
  );
}

/** Ergebnis oder `null`, damit ein ausgefallener Block die Seite nicht kostet. */
async function settle<T>(what: string, work: Promise<T>): Promise<T | null> {
  try {
    return await work;
  } catch (error) {
    console.error(`[crm] load overview ${what}:`, error);
    return null;
  }
}
