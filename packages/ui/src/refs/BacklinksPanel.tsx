'use client';

import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { EmptyState } from '../components/EmptyState.tsx';
import { ErrorState } from '../components/ErrorState.tsx';
import { Skeleton } from '../components/Skeleton.tsx';
import { cn } from '../lib/cn.ts';
import { focusRing } from '../lib/focus.ts';
import { strings } from '../strings.ts';
import { RefChip } from './RefChip.tsx';
import type { BacklinkItem, BacklinkKind, LoadBacklinks } from './platform-refs.ts';

/**
 * Was von anderswo auf ein Objekt zeigt (ADR 0023 G): Seiten, Aufgaben,
 * Deals, die es verlinken, erwaehnen oder aus ihm entstanden sind. Die
 * Plattform liefert nur, was die Person in beiden Apps lesen darf; das Panel
 * zeigt es nur an. Leerer und Fehlerzustand sind eigene Faelle.
 */

export interface BacklinksPanelProps {
  load: LoadBacklinks;
  /** Ueberschrift; Default „Referenced in“. */
  title?: string;
  /** Quellen dieser App weglassen, etwa die eigenen Rueckverweise des Wikis. */
  excludeApps?: readonly string[];
  className?: string;
}

type PanelState =
  | { status: 'loading' }
  | { status: 'done'; items: readonly BacklinkItem[] }
  | { status: 'error' };

const KIND_LABEL: Record<BacklinkKind, () => string> = {
  link: () => strings.refs.kindLink,
  mention: () => strings.refs.kindMention,
  derived: () => strings.refs.kindDerived,
};

/** App eines Verweises, `wiki` aus `wiki:page:1`. */
function appOf(ref: string): string {
  return ref.split(':', 1)[0] ?? '';
}

export function BacklinksPanel({
  load,
  title,
  excludeApps = [],
  className,
}: BacklinksPanelProps): JSX.Element {
  const [state, setState] = useState<PanelState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    load().then(
      (items) => {
        if (alive) setState({ status: 'done', items });
      },
      () => {
        if (alive) setState({ status: 'error' });
      },
    );
    return () => {
      alive = false;
    };
  }, [load, attempt]);

  const items =
    state.status === 'done'
      ? state.items.filter((item) => !excludeApps.includes(appOf(item.source)))
      : [];

  return (
    <section
      data-oa-backlinks=""
      aria-label={title ?? strings.refs.backlinksTitle}
      className={cn('flex min-w-0 flex-col gap-3', className)}
    >
      <h2 className="font-mono text-2xs uppercase tracking-label text-fg-subtle">
        {title ?? strings.refs.backlinksTitle}
      </h2>
      {state.status === 'loading' ? (
        <div aria-busy="true" className="flex flex-col gap-2">
          <span className="sr-only">{strings.refs.backlinksLoading}</span>
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-5 w-1/2" />
        </div>
      ) : null}
      {state.status === 'error' ? (
        <ErrorState
          title={strings.refs.backlinksErrorTitle}
          description={strings.refs.backlinksErrorDescription}
          action={
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className={cn('text-sm underline underline-offset-2', focusRing)}
            >
              {strings.refs.retry}
            </button>
          }
        />
      ) : null}
      {state.status === 'done' && items.length === 0 ? (
        <EmptyState
          title={strings.refs.backlinksEmptyTitle}
          description={strings.refs.backlinksEmptyDescription}
        />
      ) : null}
      {items.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.source} className="flex min-w-0 flex-wrap items-baseline gap-2 text-sm">
              <RefChip state={{ status: 'done', resolution: item.resolution }} />
              <span className="text-xs text-fg-subtle">{KIND_LABEL[item.kind]()}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
