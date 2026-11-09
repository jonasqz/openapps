import type { JSX, ReactNode } from 'react';
import { cn } from '../lib/cn.ts';

export interface EmptyStateProps {
  /** Was fehlt — als Aussage, nicht als Entschuldigung. */
  title: string;
  /** Warum es leer ist und was man tun kann. */
  description?: string;
  /** Der eine nächste Schritt. Mehr als zwei Knöpfe sind keine Hilfe. */
  action?: ReactNode;
  /** Dekoratives Zeichen. Trägt keine Information. */
  icon?: ReactNode;
  className?: string;
}

/**
 * Leerer Zustand. Jede Liste braucht ihn (Regel aus `AGENTS.md`), und der
 * Linter prüft, dass er importiert ist.
 */
export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: EmptyStateProps): JSX.Element {
  return (
    <div
      data-oa-empty-state=""
      className={cn(
        'flex min-w-0 flex-col items-center justify-center gap-3 rounded-lg',
        'border border-dashed border-border bg-surface px-4 py-10 text-center',
        className,
      )}
    >
      {icon === undefined ? null : (
        <span aria-hidden="true" className="text-2xl text-fg-subtle">
          {icon}
        </span>
      )}
      <h3 className="max-w-prose text-base font-semibold text-fg [overflow-wrap:anywhere]">
        {title}
      </h3>
      {description === undefined ? null : (
        <p className="max-w-prose text-sm text-fg-muted [overflow-wrap:anywhere]">{description}</p>
      )}
      {action === undefined ? null : <div className="mt-1 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}
