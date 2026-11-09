'use client';

import type { JSX, ReactNode } from 'react';
import { cn } from '../lib/cn.ts';
import { Button } from '../components/Button.tsx';
import { Input } from '../components/Input.tsx';
import { Pagination } from '../components/Pagination.tsx';
import { Select } from '../components/Select.tsx';
import { Table } from '../components/Table.tsx';
import { EmptyState } from '../components/EmptyState.tsx';
import { ErrorState } from '../components/ErrorState.tsx';
import type { SelectOption } from '../components/Select.tsx';
import type { TableColumn } from '../components/Table.tsx';
import { strings } from '../strings.ts';

export interface ListFilter {
  id: string;
  label: string;
  options: readonly SelectOption[];
  value: string;
  onChange: (value: string) => void;
  /** Erster Eintrag, der „alles“ bedeutet. */
  placeholder?: string;
}

export interface ListPatternProps<Row> {
  /** Überschrift der Seite. */
  title: string;
  description?: string;
  /** Knöpfe oben rechts, z. B. „Neu“. */
  actions?: ReactNode;

  /** Freitextsuche. Entfällt, wenn nicht gesetzt. */
  search?: { label: string; value: string; onChange: (value: string) => void; placeholder?: string };
  /** Auswahlfilter. Auf Phone-Breite untereinander. */
  filters?: readonly ListFilter[];
  /** Setzt alle Filter zurück. Erscheint nur, wenn ein Filter aktiv ist. */
  onResetFilters?: () => void;
  filtersActive?: boolean;

  columns: readonly TableColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row, index: number) => string;
  onRowActivate?: (row: Row) => void;

  loading?: boolean;
  /** Fehler beim Laden. Ersetzt die Tabelle, Filter bleiben bedienbar. */
  error?: { title: string; description?: string; retry?: () => void };
  /** Leer, weil es nichts gibt. */
  empty: { title: string; description?: string; action?: ReactNode };
  /** Leer, weil die Filter zu eng sind — anderer Text, anderer Ausweg. */
  emptyFiltered?: { title: string; description?: string };

  page?: number;
  pageSize?: number;
  total?: number;
  onPageChange?: (page: number) => void;

  className?: string;
}

/**
 * Muster „Liste mit Filter“.
 *
 * Deckt die fünf Zustände ab, die der Guide verlangt: lädt, Fehler, leer,
 * leer-trotz-Filter und viele Einträge (Seitenweiterschaltung). Eine App füllt
 * nur Daten und Spalten.
 */
export function ListPattern<Row>({
  title,
  description,
  actions,
  search,
  filters = [],
  onResetFilters,
  filtersActive = false,
  columns,
  rows,
  rowKey,
  onRowActivate,
  loading = false,
  error,
  empty,
  emptyFiltered,
  page,
  pageSize,
  total,
  onPageChange,
  className,
}: ListPatternProps<Row>): JSX.Element {
  const showPagination =
    page !== undefined && pageSize !== undefined && total !== undefined && onPageChange !== undefined;

  const emptyForState =
    filtersActive && emptyFiltered !== undefined
      ? {
          title: emptyFiltered.title,
          ...(emptyFiltered.description === undefined ? {} : { description: emptyFiltered.description }),
          ...(onResetFilters === undefined
            ? {}
            : {
                action: (
                  <Button variant="secondary" size="sm" onClick={onResetFilters}>
                    {strings.list.resetFilters}
                  </Button>
                ),
              }),
        }
      : empty;

  return (
    <section className={cn('flex min-w-0 flex-col gap-5', className)} aria-labelledby="oa-list-title">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 id="oa-list-title" className="text-2xl font-semibold text-fg [overflow-wrap:anywhere]">
            {title}
          </h1>
          {description === undefined ? null : (
            <p className="mt-1 text-sm text-fg-muted [overflow-wrap:anywhere]">{description}</p>
          )}
        </div>
        {actions === undefined ? null : <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </header>

      {search !== undefined || filters.length > 0 ? (
        <div
          role="search"
          className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3 sm:flex-row sm:flex-wrap sm:items-end"
        >
          {search === undefined ? null : (
            <Input
              label={search.label}
              type="search"
              value={search.value}
              placeholder={search.placeholder ?? strings.list.searchPlaceholder}
              onChange={(event) => search.onChange(event.target.value)}
              fieldClassName="min-w-0 flex-1 sm:max-w-xs"
            />
          )}
          {filters.map((filter) => (
            <Select
              key={filter.id}
              label={filter.label}
              options={filter.options}
              value={filter.value}
              onChange={(event) => filter.onChange(event.target.value)}
              fieldClassName="min-w-0 sm:w-48"
              {...(filter.placeholder === undefined ? {} : { placeholder: filter.placeholder })}
            />
          ))}
          {filtersActive && onResetFilters !== undefined ? (
            <Button variant="ghost" size="md" onClick={onResetFilters} className="sm:mb-0">
              {strings.list.resetFiltersShort}
            </Button>
          ) : null}
        </div>
      ) : null}

      {error === undefined ? (
        <>
          <Table
            caption={title}
            columns={columns}
            rows={rows}
            rowKey={rowKey}
            loading={loading}
            empty={emptyForState}
            {...(onRowActivate === undefined ? {} : { onRowActivate })}
          />
          {showPagination ? (
            <Pagination
              page={page}
              pageSize={pageSize}
              total={total}
              onPageChange={onPageChange}
              loading={loading}
            />
          ) : null}
        </>
      ) : (
        <ErrorState
          title={error.title}
          {...(error.description === undefined ? {} : { description: error.description })}
          {...(error.retry === undefined
            ? {}
            : {
                action: (
                  <Button variant="secondary" size="sm" onClick={error.retry}>
                    {strings.list.reload}
                  </Button>
                ),
              })}
        />
      )}
    </section>
  );
}

/** Wieder-Export, damit der Linter den Muster-Import als vollständig ansieht. */
export { EmptyState, ErrorState };
