'use client';

import { useId, useState } from 'react';
import type { JSX } from 'react';
import { Button } from '../components/Button.tsx';
import { EmptyState } from '../components/EmptyState.tsx';
import { ErrorState } from '../components/ErrorState.tsx';
import { Spinner } from '../components/Spinner.tsx';
import { cn } from '../lib/cn.ts';
import { focusRing } from '../lib/focus.ts';
import { strings } from '../strings.ts';
import type { LoadActions, RefActionItem } from './platform-refs.ts';

/**
 * „Aus X wird Y“ (ADR 0023 E): ein Knopf, der die Aktionen anderer Apps fuer
 * ein Objekt laedt, etwa „Create task“ aus einer Wiki-Seite. Jede Aktion ist
 * ein Link in die Ziel-App; die Person bestaetigt dort unter ihrer eigenen
 * Identitaet. Es gibt keinen Aufruf im Namen der Person von App zu App.
 *
 * Geladen wird erst beim Oeffnen, mit dem Auszug von `excerpt()` (etwa dem
 * Abschnitt unter einer Ueberschrift).
 */

export interface RefActionsMenuProps {
  load: LoadActions;
  /** Kurzer Auszug fuer die Ziel-App, beim Oeffnen gelesen. */
  excerpt?: () => string;
  /** Text des Knopfs; Default „Create from this“. */
  label?: string;
  /** Eine App kann die Liste auf ihre Aktionen begrenzen. */
  only?: (action: RefActionItem) => boolean;
  className?: string;
}

type MenuState =
  | { status: 'closed' }
  | { status: 'loading' }
  | { status: 'done'; actions: readonly RefActionItem[] }
  | { status: 'error' };

export function RefActionsMenu({
  load,
  excerpt,
  label,
  only,
  className,
}: RefActionsMenuProps): JSX.Element {
  const listId = useId().replace(/:/g, '');
  const [state, setState] = useState<MenuState>({ status: 'closed' });

  async function open(): Promise<void> {
    if (state.status !== 'closed' && state.status !== 'error') {
      setState({ status: 'closed' });
      return;
    }
    setState({ status: 'loading' });
    try {
      const actions = await load(excerpt?.());
      setState({ status: 'done', actions: only === undefined ? actions : actions.filter(only) });
    } catch {
      setState({ status: 'error' });
    }
  }

  const expanded = state.status !== 'closed';
  return (
    <div data-oa-ref-actions="" className={cn('flex min-w-0 flex-col items-start gap-2', className)}>
      <Button
        variant="secondary"
        size="sm"
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={() => void open()}
      >
        {label ?? strings.refs.actionsLabel}
      </Button>
      <div id={listId} className={cn('w-full', !expanded && 'hidden')}>
        {state.status === 'loading' ? (
          <Spinner size="sm" label={strings.refs.actionsLoading} />
        ) : null}
        {state.status === 'error' ? <ErrorState title={strings.refs.actionsError} /> : null}
        {state.status === 'done' && state.actions.length === 0 ? (
          <EmptyState title={strings.refs.actionsEmpty} />
        ) : null}
        {state.status === 'done' && state.actions.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {state.actions.map((action) => (
              <li key={`${action.app}:${action.name}`}>
                <a
                  href={action.href}
                  className={cn(
                    'inline-flex items-baseline gap-2 rounded-sm px-2 py-1 text-sm text-fg hover:bg-surface-hover',
                    focusRing,
                  )}
                >
                  {action.title}
                  <span className="font-mono text-2xs uppercase tracking-label text-fg-subtle">
                    {action.appTitle}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
