import type { JSX, ReactNode } from 'react';
import { cn } from '../lib/cn.ts';
import { Card, CardBody, CardHeader } from '../components/Card.tsx';
import { ErrorState } from '../components/ErrorState.tsx';
import { Spinner } from '../components/Spinner.tsx';
import { strings } from '../strings.ts';

export interface DetailField {
  label: string;
  /** Wert. Sehr lange Werte brechen um, sie schneiden nicht ab. */
  value: ReactNode;
  /** Über die ganze Breite statt in der Spalte. */
  wide?: boolean;
}

export interface DetailSection {
  title: string;
  fields: readonly DetailField[];
}

export interface DetailPatternProps {
  title: string;
  /** Kleiner Text über dem Titel, z. B. Kategorie oder ID. */
  eyebrow?: string;
  /** Badges neben dem Titel. */
  meta?: ReactNode;
  /** Knöpfe oben rechts. */
  actions?: ReactNode;
  /** Zurück-Verweis. Steht als erstes in der Fokus-Reihenfolge. */
  back?: { label: string; onClick: () => void };
  sections: readonly DetailSection[];
  /** Zusätzlicher Inhalt unter den Abschnitten (Verlauf, Tabellen …). */
  children?: ReactNode;
  loading?: boolean;
  error?: { title: string; description?: string; action?: ReactNode };
  className?: string;
}

/**
 * Muster „Detailansicht“.
 *
 * Kopfbereich mit Titel, Status und Aktionen, darunter Abschnitte aus
 * Label/Wert-Paaren. Auf Phone-Breite einspaltig, ab `sm` zweispaltig.
 */
export function DetailPattern({
  title,
  eyebrow,
  meta,
  actions,
  back,
  sections,
  children,
  loading = false,
  error,
  className,
}: DetailPatternProps): JSX.Element {
  if (error !== undefined) {
    return (
      <ErrorState
        title={error.title}
        {...(error.description === undefined ? {} : { description: error.description })}
        {...(error.action === undefined ? {} : { action: error.action })}
      />
    );
  }

  return (
    <article className={cn('flex min-w-0 flex-col gap-5', className)}>
      {back === undefined ? null : (
        <button
          type="button"
          onClick={back.onClick}
          className="self-start rounded-md text-sm font-medium text-primary underline-offset-2 hover:underline outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <span aria-hidden="true">← </span>
          {back.label}
        </button>
      )}

      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {eyebrow === undefined ? null : (
            <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">{eyebrow}</p>
          )}
          <h1 className="mt-0.5 text-2xl font-semibold text-fg [overflow-wrap:anywhere]">{title}</h1>
          {meta === undefined ? null : <div className="mt-2 flex flex-wrap gap-2">{meta}</div>}
        </div>
        {actions === undefined ? null : <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-fg-muted">
          <Spinner size="sm" label={null} />
          <span>{strings.detail.loading}</span>
        </div>
      ) : (
        sections.map((section) => (
          <Card key={section.title}>
            <CardHeader as="h2" title={section.title} />
            <CardBody>
              <dl className="grid min-w-0 gap-4 sm:grid-cols-2">
                {section.fields.map((field) => (
                  <div
                    key={field.label}
                    className={cn('min-w-0', field.wide === true && 'sm:col-span-2')}
                  >
                    <dt className="text-xs font-medium uppercase tracking-wide text-fg-muted">
                      {field.label}
                    </dt>
                    <dd className="mt-1 text-sm text-fg [overflow-wrap:anywhere]">{field.value}</dd>
                  </div>
                ))}
              </dl>
            </CardBody>
          </Card>
        ))
      )}

      {children}
    </article>
  );
}
