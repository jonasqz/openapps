import { Badge, Card, CardBody, CardHeader, EmptyState, ErrorState } from '@openapps/ui';
import { ButtonLink, TextLink } from '@/components/links';
import { listDeals, pipelineSummary, type Deal } from '@/lib/crm';
import { STAGE_LABELS, type Stage } from '@/lib/domain';
import { formatDate, formatEuro } from '@/lib/format';
import type { PipelineSummary } from '@/lib/pipeline';

export const dynamic = 'force-dynamic';

/**
 * Pipeline: je Stage eine Spalte mit Anzahl, Summe und den Deals darin.
 * Dieselben Zahlen liefert das Tool `pipeline.summary`.
 */
export default async function PipelinePage() {
  let summary: PipelineSummary | null = null;
  let deals: Deal[] = [];
  try {
    [summary, deals] = await Promise.all([pipelineSummary(), listDeals({ limit: 200 })]);
  } catch (error) {
    console.error('[crm] Pipeline laden:', error);
    summary = null;
  }

  return (
    <>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-fg">Pipeline</h1>
          <p className="mt-1 text-sm text-fg-muted">
            Offene Deals mit Summe je Stage. Gewichtet nach Abschlusswahrscheinlichkeit.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <ButtonLink href="/deals/stage" variant="secondary">
            Stage ändern
          </ButtonLink>
          <ButtonLink href="/deals/neu">Neuer Deal</ButtonLink>
        </div>
      </header>

      {summary === null ? (
        <ErrorState
          title="Pipeline konnte nicht geladen werden"
          description="Die Datenbank hat nicht geantwortet. Lade die Seite neu."
        />
      ) : (
        <>
          <section aria-label="Kennzahlen" className="grid gap-4 sm:grid-cols-3">
            <Kennzahl label="Offen" value={formatEuro(summary.totals.openSumCents)} hint={`${summary.totals.openCount} Deals`} />
            <Kennzahl label="Gewichtet" value={formatEuro(summary.totals.weightedOpenCents)} hint="Summe × Wahrscheinlichkeit" />
            <Kennzahl label="Gewonnen" value={formatEuro(summary.totals.wonCents)} hint={`Verloren: ${formatEuro(summary.totals.lostCents)}`} />
          </section>

          {summary.totals.count === 0 ? (
            <EmptyState
              title="Noch keine Deals"
              description="Lege den ersten Deal an, dann erscheint er hier in seiner Stage."
              action={<ButtonLink href="/deals/neu">Neuer Deal</ButtonLink>}
            />
          ) : (
            <section aria-label="Stages" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {summary.stages.map((stage) => (
                <StageColumn
                  key={stage.stage}
                  stage={stage.stage}
                  count={stage.count}
                  sumCents={stage.sumCents}
                  probability={stage.probability}
                  deals={deals.filter((deal) => deal.stage === stage.stage)}
                />
              ))}
            </section>
          )}
        </>
      )}
    </>
  );
}

function Kennzahl({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card>
      <CardBody>
        <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">{label}</p>
        <p className="mt-1 text-2xl font-semibold text-fg">{value}</p>
        <p className="mt-1 text-sm text-fg-muted">{hint}</p>
      </CardBody>
    </Card>
  );
}

const STAGE_TONE: Readonly<Record<Stage, 'neutral' | 'primary' | 'success' | 'warning' | 'danger'>> = {
  lead: 'neutral',
  qualifiziert: 'primary',
  angebot: 'warning',
  gewonnen: 'success',
  verloren: 'danger',
};

function StageColumn({
  stage,
  count,
  sumCents,
  probability,
  deals,
}: {
  stage: Stage;
  count: number;
  sumCents: number;
  probability: number;
  deals: Deal[];
}) {
  return (
    <Card>
      <CardHeader
        as="h2"
        title={
          <span className="flex items-center gap-2">
            {STAGE_LABELS[stage]}
            <Badge tone={STAGE_TONE[stage]} srPrefix="Anzahl:">
              {count}
            </Badge>
          </span>
        }
        description={`${formatEuro(sumCents)} · ${probability} %`}
      />
      <CardBody>
        {deals.length === 0 ? (
          <p className="text-sm text-fg-muted">Keine Deals in dieser Stage.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {deals.map((deal) => (
              <li key={deal.id} className="min-w-0 border-b border-border pb-3 last:border-b-0 last:pb-0">
                <p className="text-sm font-medium text-fg [overflow-wrap:anywhere]">{deal.title}</p>
                <p className="text-sm text-fg-muted [overflow-wrap:anywhere]">
                  <TextLink href={`/firmen/${deal.companyId}`}>{deal.companyName}</TextLink>
                </p>
                <p className="mt-1 flex flex-wrap justify-between gap-2 text-sm">
                  <span className="font-semibold text-fg">{formatEuro(deal.valueCents)}</span>
                  <span className="text-fg-muted">{formatDate(deal.expectedClose)}</span>
                </p>
                <p className="mt-1 text-sm">
                  <TextLink href={`/deals/stage?deal=${deal.id}`}>Stage ändern</TextLink>
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
