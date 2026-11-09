import type { JSX, ReactNode } from 'react';
import { cn } from '../lib/cn.ts';
import { strings } from '../strings.ts';

export interface ErrorStateProps {
  /** Was nicht ging, in Worten des Nutzers. */
  title: string;
  /** Technische Einzelheit, falls sie hilft. Bricht auch sehr lang nicht aus. */
  description?: string;
  /** Kennung für den Support. Wird zum Kopieren klein angezeigt. */
  correlationId?: string;
  /** Wiederholen-Knopf o. Ä. */
  action?: ReactNode;
  className?: string;
}

/**
 * Fehlerzustand. `role="alert"` kündigt ihn an, sobald er erscheint.
 * Gegenstück zu `EmptyState` — der Linter verlangt beide bei jeder Liste.
 */
export function ErrorState({
  title,
  description,
  correlationId,
  action,
  className,
}: ErrorStateProps): JSX.Element {
  return (
    <div
      data-oa-error-state=""
      role="alert"
      className={cn(
        'flex min-w-0 flex-col items-start gap-2 rounded-lg border border-danger',
        'bg-danger-subtle px-4 py-4 text-danger-subtle-fg',
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        <span aria-hidden="true" className="shrink-0 text-base leading-6">
          ⚠
        </span>
        <h3 className="min-w-0 text-base font-semibold [overflow-wrap:anywhere]">{title}</h3>
      </div>
      {description === undefined ? null : (
        <p className="max-w-prose text-sm [overflow-wrap:anywhere]">{description}</p>
      )}
      {correlationId === undefined ? null : (
        <p className="text-xs">
          <span className="font-medium">{strings.errorState.correlationId}</span>
          <code className="font-mono [overflow-wrap:anywhere]">{correlationId}</code>
        </p>
      )}
      {action === undefined ? null : <div className="mt-1 flex flex-wrap gap-2">{action}</div>}
    </div>
  );
}
