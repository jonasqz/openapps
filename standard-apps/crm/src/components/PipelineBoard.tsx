'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type DragEvent, type JSX } from 'react';
import { Badge, EmptyState, ErrorState, cn } from '@openapps/ui';
import { isClosedStage, STAGE_LABELS, STAGES, type Stage } from '@/lib/domain';
import { StageSelect, useStageMover, type MovableDeal } from './StageMover';

/** Eine Karte, fertig aufbereitet von der Server-Seite. */
export interface BoardDeal extends MovableDeal {
  companyId: string;
  companyName: string;
  valueLabel: string;
  closeLabel: string;
  owner: string | null;
  nextStep: { title: string; dueLabel: string; overdue: boolean } | null;
}

export interface BoardColumn {
  stage: Stage;
  count: number;
  sumLabel: string;
  probability: number;
  /** Bei won/lost nur die zuletzt geschlossenen; `count` zaehlt alle. */
  limited: boolean;
}

const STAGE_TONE: Readonly<Record<Stage, 'neutral' | 'primary' | 'success' | 'warning' | 'danger'>> = {
  lead: 'neutral',
  qualified: 'primary',
  proposal: 'warning',
  won: 'success',
  lost: 'danger',
};

const DRAG_TYPE = 'application/x-crm-deal';

/**
 * Pipeline als Board: eine Spalte je Stage. Karten lassen sich ziehen; wer
 * nicht zieht (Tastatur, Telefon), nimmt die Stage-Auswahl an der Karte.
 * Beides ruft dasselbe Tool `deals.update_stage`.
 */
export function PipelineBoard({
  deals,
  columns,
  failed,
}: {
  deals: readonly BoardDeal[];
  columns: readonly BoardColumn[];
  failed: boolean;
}): JSX.Element {
  const [local, setLocal] = useState<readonly BoardDeal[]>(deals);
  const [dropTarget, setDropTarget] = useState<Stage | null>(null);
  // Nach router.refresh() kommen neue Daten vom Server; die gelten.
  useEffect(() => setLocal(deals), [deals]);

  const { move, dialog } = useStageMover((dealId, stage) =>
    setLocal((current) => current.map((deal) => (deal.id === dealId ? { ...deal, stage } : deal))),
  );

  const byStage = useMemo(() => {
    const map = new Map<Stage, BoardDeal[]>(STAGES.map((stage) => [stage, []]));
    for (const deal of local) map.get(deal.stage)?.push(deal);
    return map;
  }, [local]);

  if (failed) {
    return (
      <ErrorState title="Pipeline could not be loaded" description="The database did not respond. Reload the page." />
    );
  }
  if (deals.length === 0) {
    return (
      <EmptyState
        title="No deals yet"
        description="Create the first deal and it will show up here in its stage."
        action={
          <Link href="/deals/new" className="text-sm font-medium text-primary underline-offset-2 hover:underline">
            New deal
          </Link>
        }
      />
    );
  }

  const onDrop = (event: DragEvent<HTMLElement>, stage: Stage): void => {
    event.preventDefault();
    setDropTarget(null);
    const id = event.dataTransfer.getData(DRAG_TYPE);
    const deal = local.find((candidate) => candidate.id === id);
    if (deal !== undefined) move(deal, stage);
  };

  return (
    <>
      <div className="grid min-w-0 gap-4 md:grid-cols-3 xl:grid-cols-5">
        {columns.map((column) => {
          const cards = byStage.get(column.stage) ?? [];
          return (
            <section
              key={column.stage}
              aria-labelledby={`stage-${column.stage}`}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
                event.preventDefault();
                setDropTarget(column.stage);
              }}
              onDragLeave={() => setDropTarget((current) => (current === column.stage ? null : current))}
              onDrop={(event) => onDrop(event, column.stage)}
              className={cn(
                'flex min-w-0 flex-col rounded-lg border border-border bg-surface',
                dropTarget === column.stage && 'border-primary bg-primary-subtle',
              )}
            >
              <header className="border-b border-border px-3 py-3">
                <h2 id={`stage-${column.stage}`} className="flex items-center justify-between gap-2">
                  <span className="font-mono text-2xs font-medium uppercase tracking-label text-fg-muted">
                    {STAGE_LABELS[column.stage]}
                  </span>
                  <Badge tone={STAGE_TONE[column.stage]} srPrefix="Deals:">
                    {column.count}
                  </Badge>
                </h2>
                <p className="mt-1 text-sm tabular-nums text-fg">
                  {column.sumLabel}
                  <span className="text-fg-muted">{` · ${column.probability} %`}</span>
                </p>
              </header>
              {cards.length === 0 ? (
                <p className="px-3 py-4 text-sm text-fg-muted">
                  {isClosedStage(column.stage) ? 'Nothing closed here yet.' : 'Drop a deal here.'}
                </p>
              ) : (
                <ul className="flex min-w-0 flex-col gap-2 p-2">
                  {cards.map((deal) => (
                    <li
                      key={deal.id}
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.setData(DRAG_TYPE, deal.id);
                        event.dataTransfer.effectAllowed = 'move';
                      }}
                      className="min-w-0 cursor-grab rounded-md border border-border bg-bg p-3 active:cursor-grabbing"
                    >
                      <Link
                        href={`/deals/${deal.id}`}
                        className="block text-sm font-medium text-fg underline-offset-2 hover:underline [overflow-wrap:anywhere]"
                      >
                        {deal.title}
                      </Link>
                      <p className="mt-0.5 truncate text-xs text-fg-muted" title={deal.companyName}>
                        {deal.companyName}
                      </p>
                      <p className="mt-2 flex flex-wrap items-baseline justify-between gap-2 text-sm">
                        <span className="font-medium tabular-nums text-fg">{deal.valueLabel}</span>
                        <span className="text-xs text-fg-muted">{deal.closeLabel}</span>
                      </p>
                      {deal.nextStep === null ? (
                        isClosedStage(deal.stage) ? null : (
                          <p className="mt-2 text-xs text-warning">No next step</p>
                        )
                      ) : (
                        <p className="mt-2 flex min-w-0 flex-wrap items-center gap-1 text-xs text-fg-muted">
                          {deal.nextStep.overdue ? <Badge tone="danger">Overdue</Badge> : null}
                          <span className="min-w-0 [overflow-wrap:anywhere]">
                            {`${deal.nextStep.title} · ${deal.nextStep.dueLabel}`}
                          </span>
                        </p>
                      )}
                      {deal.owner === null ? null : (
                        <p className="mt-1 truncate text-xs text-fg-subtle" title={deal.owner}>
                          {deal.owner}
                        </p>
                      )}
                      <div className="mt-2">
                        <StageSelect deal={deal} onMove={move} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {column.limited ? (
                <p className="mt-auto border-t border-border px-3 py-2 text-xs">
                  <Link
                    href={`/deals?stage=${column.stage}`}
                    className="font-medium text-primary underline-offset-2 hover:underline"
                  >
                    {`All ${column.count} ${STAGE_LABELS[column.stage].toLowerCase()} deals`}
                  </Link>
                </p>
              ) : null}
            </section>
          );
        })}
      </div>
      {dialog}
    </>
  );
}
