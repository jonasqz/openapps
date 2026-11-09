import type { JSX, ReactNode } from 'react';
import { cn } from '../lib/cn.ts';
import { EmptyState } from './EmptyState.tsx';
import { ErrorState } from './ErrorState.tsx';
import { Spinner } from './Spinner.tsx';
import { strings } from '../strings.ts';

export interface TableColumn<Row> {
  /** Stabiler Schlüssel, auch der React-Key der Zelle. */
  key: string;
  header: ReactNode;
  /** Zelleninhalt. Reiner Text wird abgeschnitten, nicht umgebrochen. */
  cell: (row: Row) => ReactNode;
  /** Zahlenspalten rechts. */
  align?: 'left' | 'right';
  /** Auf Phone-Breite ausblenden, damit nichts waagerecht scrollt. */
  hideBelow?: 'sm' | 'md' | 'lg';
  /** Zusätzliche Klassen für die Spalte, z. B. `w-1/2` oder `max-w-field`. */
  className?: string;
}

export interface TableProps<Row> {
  /** Was die Tabelle zeigt — Pflicht, Screenreader lesen es als Beschriftung. */
  caption: string;
  columns: readonly TableColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row, index: number) => string;
  /** Lädt: zeigt Platzhalterzeilen statt die Tabelle zu verstecken. */
  loading?: boolean;
  /** Fehler: ersetzt den Tabellenkörper durch `ErrorState`. */
  error?: { title: string; description?: string; action?: ReactNode };
  /** Leer: ersetzt den Tabellenkörper durch `EmptyState`. */
  empty?: { title: string; description?: string; action?: ReactNode };
  /** Zeile anklickbar machen. Erzeugt einen Knopf in der ersten Zelle. */
  onRowActivate?: (row: Row) => void;
  className?: string;
}

const HIDE = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell' } as const;

/**
 * Tabelle mit allen Zuständen: lädt, Fehler, leer, viele Zeilen, sehr langer
 * Text. Zellen schneiden ab (`truncate`) und tragen `title`, damit auf
 * Phone-Breite nichts waagerecht scrollt — dafür sind Spalten über
 * `hideBelow` ausblendbar.
 */
export function Table<Row>({
  caption,
  columns,
  rows,
  rowKey,
  loading = false,
  error,
  empty,
  onRowActivate,
  className,
}: TableProps<Row>): JSX.Element {
  if (error !== undefined) {
    return (
      <ErrorState
        title={error.title}
        {...(error.description === undefined ? {} : { description: error.description })}
        {...(error.action === undefined ? {} : { action: error.action })}
      />
    );
  }

  const showEmpty = !loading && rows.length === 0;

  return (
    <div className={cn('min-w-0', className)}>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full table-fixed border-collapse text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-surface">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cn(
                    'border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-fg-muted',
                    column.align === 'right' && 'text-right',
                    column.hideBelow === undefined ? undefined : HIDE[column.hideBelow],
                    column.className,
                  )}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody aria-busy={loading || undefined}>
            {loading
              ? Array.from({ length: 3 }, (_, index) => (
                  <tr key={`oa-skeleton-${index}`}>
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={cn(
                          'border-b border-border px-3 py-3',
                          column.hideBelow === undefined ? undefined : HIDE[column.hideBelow],
                        )}
                      >
                        <span className="block h-4 w-full animate-oa-fade-in rounded-sm bg-surface-muted" />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.map((row, index) => (
                  <tr
                    key={rowKey(row, index)}
                    className="odd:bg-bg even:bg-surface hover:bg-surface-hover"
                  >
                    {columns.map((column, columnIndex) => {
                      const content = column.cell(row);
                      return (
                        <td
                          key={column.key}
                          className={cn(
                            'border-b border-border px-3 py-2 align-top text-fg',
                            column.align === 'right' && 'text-right',
                            column.hideBelow === undefined ? undefined : HIDE[column.hideBelow],
                            column.className,
                          )}
                        >
                          {columnIndex === 0 && onRowActivate !== undefined ? (
                            <button
                              type="button"
                              onClick={() => onRowActivate(row)}
                              className="block w-full truncate rounded-sm text-left font-medium text-primary underline-offset-2 hover:underline outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
                            >
                              {content}
                            </button>
                          ) : (
                            <span className="block truncate">{content}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
      {loading ? (
        <div className="mt-2">
          <Spinner size="sm" label={strings.table.loadingLabel(caption)} />
        </div>
      ) : null}
      {showEmpty ? (
        <div className="mt-3">
          <EmptyState
            title={empty?.title ?? strings.table.emptyTitle}
            {...(empty?.description === undefined ? {} : { description: empty.description })}
            {...(empty?.action === undefined ? {} : { action: empty.action })}
          />
        </div>
      ) : null}
    </div>
  );
}
