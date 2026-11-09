import type { JSX } from 'react';
import { cn } from '../lib/cn.ts';
import { Button } from './Button.tsx';
import { strings } from '../strings.ts';

export interface PaginationProps {
  /** 1-basiert. */
  page: number;
  pageSize: number;
  /** Gesamtzahl der Einträge, nicht der Seiten. */
  total: number;
  onPageChange: (page: number) => void;
  /** Blockiert die Knöpfe, während nachgeladen wird. */
  loading?: boolean;
  className?: string;
}

export function pageCount(total: number, pageSize: number): number {
  if (pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

/**
 * Seitenweiterschaltung. Der Fall „zu viele Einträge“ aus dem Guide lebt hier:
 * Listen zeigen nie alles, sie zeigen eine Seite und sagen, wie viele es sind.
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  loading = false,
  className,
}: PaginationProps): JSX.Element {
  const last = pageCount(total, pageSize);
  const current = Math.min(Math.max(1, page), last);
  const from = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const to = Math.min(current * pageSize, total);

  return (
    <nav
      aria-label={strings.pagination.label}
      className={cn('flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between', className)}
    >
      <p className="text-sm text-fg-muted" aria-live="polite">
        {total === 0
          ? strings.pagination.empty
          : strings.pagination.range(from, to, total, current, last)}
      </p>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={current <= 1 || loading}
          onClick={() => onPageChange(current - 1)}
        >
          {strings.pagination.previous}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={current >= last || loading}
          onClick={() => onPageChange(current + 1)}
        >
          {strings.pagination.next}
        </Button>
      </div>
    </nav>
  );
}
