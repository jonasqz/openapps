'use client';

import { useId, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import { focusRing } from '../lib/focus.ts';
import { Icon } from './Icon.tsx';
import { cn } from '../lib/cn.ts';
import { EmptyState } from './EmptyState.tsx';
import { ErrorState } from './ErrorState.tsx';
import { Spinner } from './Spinner.tsx';
import { strings } from '../strings.ts';

/**
 * Werte, die eine Spalte ohne `cell` selbst anzeigen kann.
 *
 * `ReactNode` deckt Text, Zahlen, `null` und fertige Elemente ab — all das
 * reicht React über die Server/Client-Grenze. `Date` und `bigint` kommen dazu,
 * weil sie aus der Datenbank kommen und React sie nicht selbst rendern kann;
 * die Tabelle formatiert sie.
 */
export type TableFieldValue = ReactNode | Date | bigint;

/** Kandidaten: Felder, deren Wert die Tabelle anzeigen kann. */
type ValueCandidates<Row> = Extract<
  { [K in keyof Row]-?: Row[K] extends TableFieldValue ? K : never }[keyof Row],
  string
>;

/**
 * Felder einer Zeile, die eine Spalte direkt anzeigen kann.
 *
 * Fällt auf `string` zurück, wenn der Zeilentyp keine Auskunft gibt — ein
 * Zeilentyp aus der Datenbank schreibt oft `extends Record<string, unknown>`,
 * und dann verschluckt die Index-Signatur jeden Feldnamen. Lieber keine
 * Feldnamen-Prüfung als eine Prop, die niemand mehr setzen kann.
 */
type ValueKeys<Row> = [ValueCandidates<Row>] extends [never] ? string : ValueCandidates<Row>;

/** Kandidaten: Felder, die als Schlüssel taugen. */
type KeyCandidates<Row> = Extract<
  { [K in keyof Row]-?: Row[K] extends string | number | bigint ? K : never }[keyof Row],
  string
>;

/** Felder einer Zeile, die als Schlüssel taugen. Fällt ebenso zurück. */
type KeyKeys<Row> = [KeyCandidates<Row>] extends [never] ? string : KeyCandidates<Row>;

export interface TableColumnBase {
  header: ReactNode;
  /** Zahlenspalten rechts. */
  align?: 'left' | 'right';
  /** Auf Phone-Breite ausblenden, damit nichts waagerecht scrollt. */
  hideBelow?: 'sm' | 'md' | 'lg';
  /** Zusätzliche Klassen für die Spalte, z. B. `w-1/2` oder `max-w-field`. */
  className?: string;
}

/**
 * Der Normalfall: Die Spalte zeigt ein Feld der Zeile.
 *
 * Serverfähig — es geht keine Funktion über die Server/Client-Grenze. Soll die
 * Zelle etwas Abgeleitetes zeigen, rechne es in der Server-Komponente aus und
 * lege es als Feld in die Zeile, statt zu `cell` zu greifen.
 */
export interface TableFieldColumn<Row> extends TableColumnBase {
  field: ValueKeys<Row>;
  /** Stabiler Schlüssel der Spalte. Vorgabe: der Feldname. */
  key?: string;
  cell?: never;
}

/**
 * Der Sonderfall: Die Spalte rechnet ihren Inhalt aus.
 *
 * **Nur aus Client-Komponenten** (`'use client'`). Eine Funktion lässt React
 * nicht von einer Server-Komponente in eine Client-Komponente reichen — der
 * Build bricht mit „Functions cannot be passed directly to Client Components".
 */
export interface TableCellColumn<Row> extends TableColumnBase {
  /** Stabiler Schlüssel, auch der React-Key der Zelle. */
  key: string;
  cell: (row: Row) => ReactNode;
  field?: never;
}

export type TableColumn<Row> = TableFieldColumn<Row> | TableCellColumn<Row>;

export interface TableProps<Row> {
  /** Was die Tabelle zeigt — Pflicht, Screenreader lesen es als Beschriftung. */
  caption: string;
  columns: readonly TableColumn<Row>[];
  rows: readonly Row[];
  /**
   * Woraus der React-Key einer Zeile kommt.
   *
   * Vorgabe ist das Feld `id`. Ein anderer Feldname ist serverfähig, eine
   * Funktion nur aus Client-Komponenten. Hat die Zeile weder `id` noch ein
   * genanntes Feld, nimmt die Tabelle den Index.
   */
  rowKey?: KeyKeys<Row> | ((row: Row, index: number) => string) | undefined;
  /** Lädt: zeigt Platzhalterzeilen statt die Tabelle zu verstecken. */
  loading?: boolean | undefined;
  /**
   * Fehler: ersetzt den Tabellenkörper durch `ErrorState`.
   *
   * `| undefined` ist Absicht, nicht Versehen: Das Repo führt
   * `exactOptionalPropertyTypes`, und ein Verbraucher setzt diesen Zustand
   * bedingt (`error={failed ? { title } : undefined}`). Ohne das explizite
   * `undefined` müsste er die Prop stattdessen spreaden — und dann sieht der
   * UI-Linter keinen Fehlerzustand mehr.
   */
  error?: { title: string; description?: string | undefined; action?: ReactNode } | undefined;
  /** Leer: ersetzt den Tabellenkörper durch `EmptyState`. */
  empty?: { title: string; description?: string | undefined; action?: ReactNode } | undefined;
  /**
   * Zeile anklickbar machen. Erzeugt einen Knopf in der ersten Zelle.
   *
   * Funktion, also **nur aus Client-Komponenten**.
   */
  onRowActivate?: ((row: Row) => void) | undefined;
  /**
   * Suchfeld über der Tabelle. Filtert im Browser über alle Spalten mit
   * `field` und zeigt „3 of 12". Serverfähig, weil nur ein Boolean.
   * Für lange Listen gehört die Suche auf den Server (`ListPattern`).
   */
  searchable?: boolean | undefined;
  /** Weitere Bedienelemente rechts in der Werkzeugleiste, z. B. Filter. */
  toolbar?: ReactNode;
  className?: string | undefined;
}

const HIDE = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell' } as const;

/** Der Spaltenschlüssel: gesetzt oder der Feldname. */
function columnKey<Row>(column: TableColumn<Row>): string {
  if (column.cell !== undefined) return column.key;
  return column.key ?? column.field;
}

/** Ein Feld der Zeile lesen, ohne die Zeile als Objekt zu typisieren. */
function readField(row: unknown, name: string): unknown {
  if (row === null || typeof row !== 'object') return undefined;
  return (row as Record<string, unknown>)[name];
}

/**
 * Was eine Spalte ohne `cell` anzeigt.
 *
 * Formatiert nur, was React nicht selbst rendern kann. `Date` wird bewusst
 * ohne `toLocaleDateString` formatiert: Die Tabelle rendert auf dem Server und
 * hydriert im Browser, und ein Format, das von Zeitzone oder Spracheinstellung
 * des Browsers abhängt, ergibt dort zwei verschiedene Zeichenketten.
 */
export function fieldContent(value: unknown): ReactNode {
  if (value === null || value === undefined || value === '') return strings.table.emptyValue;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? strings.table.emptyValue : strings.table.date(value);
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'boolean') return value ? strings.table.yes : strings.table.no;
  return value as ReactNode;
}

/** Der React-Key einer Zeile. */
function resolveRowKey<Row>(
  row: Row,
  index: number,
  rowKey: TableProps<Row>['rowKey'],
): string {
  if (typeof rowKey === 'function') return rowKey(row, index);
  const value = readField(row, rowKey ?? 'id');
  if (typeof value === 'string' && value !== '') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return `oa-row-${index}`;
}

/**
 * Tabelle mit allen Zuständen: lädt, Fehler, leer, viele Zeilen, sehr langer
 * Text. Zellen schneiden ab (`truncate`) und tragen `title`, damit auf
 * Phone-Breite nichts waagerecht scrollt — dafür sind Spalten über
 * `hideBelow` ausblendbar.
 *
 * Eine Spalte nennt im Normalfall ihr `field`; `cell` und `onRowActivate` sind
 * Funktionen und gehen nur aus einer Client-Komponente.
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
  searchable = false,
  toolbar,
  className,
}: TableProps<Row>): JSX.Element {
  const searchId = useId();
  const [query, setQuery] = useState('');

  if (error !== undefined) {
    return (
      <ErrorState
        title={error.title}
        {...(error.description === undefined ? {} : { description: error.description })}
        {...(error.action === undefined ? {} : { action: error.action })}
      />
    );
  }

  const needle = query.trim().toLowerCase();
  const shown =
    searchable && needle !== ''
      ? rows.filter((row) =>
          columns.some((column) => {
            if (column.cell !== undefined) return false;
            const value = readField(row, column.field);
            const text = value instanceof Date ? strings.table.date(value) : value;
            return (
              (typeof text === 'string' || typeof text === 'number' || typeof text === 'bigint') &&
              String(text).toLowerCase().includes(needle)
            );
          }),
        )
      : rows;
  const showEmpty = !loading && rows.length === 0;
  const showNoMatch = !loading && rows.length > 0 && shown.length === 0;
  const hasToolbar = searchable || toolbar !== undefined;

  return (
    <div className={cn('min-w-0', className)}>
      {hasToolbar ? (
        <div className="mb-3 flex min-w-0 flex-wrap items-center gap-2">
          {searchable ? (
            <div className="relative flex min-w-0 flex-1 items-center sm:max-w-field">
              <label htmlFor={searchId} className="sr-only">
                {strings.tableSearch.label(caption)}
              </label>
              <Icon name="search" className="pointer-events-none absolute left-3 text-fg-subtle" />
              <input
                id={searchId}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={strings.tableSearch.placeholder}
                className={cn(
                  'h-10 w-full min-w-0 rounded-md border border-border-strong bg-bg pl-10 pr-3 text-sm text-fg',
                  'placeholder:text-fg-subtle transition-colors duration-150 hover:border-fg-muted',
                  focusRing,
                )}
              />
            </div>
          ) : null}
          {searchable && !loading ? (
            <span aria-live="polite" className="font-mono text-2xs tabular-nums text-fg-muted">
              {strings.tableSearch.count(shown.length, rows.length)}
            </span>
          ) : null}
          {toolbar === undefined ? null : <div className="ml-auto flex flex-wrap gap-2">{toolbar}</div>}
        </div>
      ) : null}
      <div className="relative overflow-hidden rounded-lg border border-border">
        <table className="w-full table-fixed border-collapse text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-bg">
            <tr>
              {columns.map((column) => (
                <th
                  key={columnKey(column)}
                  scope="col"
                  className={cn(
                    'border-b border-border px-4 py-2.5 font-mono text-2xs font-medium uppercase tracking-label text-fg-muted',
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
                        key={columnKey(column)}
                        className={cn(
                          'border-b border-border px-4 py-3.5',
                          column.hideBelow === undefined ? undefined : HIDE[column.hideBelow],
                        )}
                      >
                        <span className="block h-4 w-full animate-oa-fade-in rounded-sm bg-surface-muted" />
                      </td>
                    ))}
                  </tr>
                ))
              : shown.map((row, index) => (
                  <tr
                    key={resolveRowKey(row, index, rowKey)}
                    className="bg-bg transition-colors duration-150 hover:bg-surface [&:last-child>td]:border-b-0"
                  >
                    {columns.map((column, columnIndex) => {
                      const content =
                        column.cell === undefined
                          ? fieldContent(readField(row, column.field))
                          : column.cell(row);
                      return (
                        <td
                          key={columnKey(column)}
                          className={cn(
                            'border-b border-border px-4 py-3 align-top text-fg',
                            column.align === 'right' && 'text-right',
                            column.hideBelow === undefined ? undefined : HIDE[column.hideBelow],
                            column.className,
                          )}
                        >
                          {columnIndex === 0 && onRowActivate !== undefined ? (
                            <button
                              type="button"
                              onClick={() => onRowActivate(row)}
                              className="block w-full truncate rounded-sm text-left font-medium text-fg decoration-primary underline-offset-4 hover:underline outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
                            >
                              {content}
                            </button>
                          ) : (
                            <span
                              className="block truncate"
                              title={typeof content === 'string' || typeof content === 'number' ? String(content) : undefined}
                            >
                              {content}
                            </span>
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
      {showNoMatch ? (
        <div className="mt-3">
          <EmptyState
            title={strings.tableSearch.noMatchTitle}
            description={strings.tableSearch.noMatchDescription(query.trim())}
            action={
              <button
                type="button"
                onClick={() => setQuery('')}
                className={cn('rounded-full border border-border-strong px-4 py-1.5 text-sm font-medium text-fg hover:border-fg', focusRing)}
              >
                {strings.tableSearch.clear}
              </button>
            }
          />
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
