import type { JSX, ReactNode } from 'react';
import { cn } from '../lib/cn.ts';
import { UiLink } from '../lib/link.tsx';
import { strings } from '../strings.ts';

export interface PageHeaderCrumb {
  label: string;
  /** Ohne `href` ist es die aktuelle Seite. */
  href?: string;
}

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Knöpfe rechts. Die Hauptaktion steht zuletzt. */
  actions?: ReactNode;
  /** Pfad über dem Titel. Ohne Pfad steht dort `eyebrow`, falls gesetzt. */
  breadcrumbs?: readonly PageHeaderCrumb[];
  /** Kleines Mono-Label über dem Titel, z. B. der Bereich: „Platform“. */
  eyebrow?: string;
  /** Badges oder Kennungen neben dem Titel. */
  meta?: ReactNode;
  className?: string;
}

/**
 * Der Kopf jeder Seite: Pfad oder Eyebrow, Titel in der Display-Serife,
 * eine Zeile Beschreibung, Aktionen rechts, darunter eine Haarlinie.
 *
 * Eine Seite hat genau einen, und er trägt die einzige `h1`.
 */
export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
  eyebrow,
  meta,
  className,
}: PageHeaderProps): JSX.Element {
  const label = 'font-mono text-2xs font-medium uppercase tracking-label text-fg-muted';
  return (
    <header
      className={cn(
        'mb-8 flex min-w-0 flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0">
        {breadcrumbs !== undefined && breadcrumbs.length > 0 ? (
          <nav aria-label={strings.pageHeader.breadcrumb} className="mb-3">
            <ol className={cn('flex min-w-0 flex-wrap items-center gap-x-2', label)}>
              {breadcrumbs.map((crumb, index) => (
                <li key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-x-2">
                  {index > 0 ? (
                    <span aria-hidden="true" className="text-fg-subtle">
                      /
                    </span>
                  ) : null}
                  {crumb.href === undefined ? (
                    <span aria-current="page" className="truncate">
                      {crumb.label}
                    </span>
                  ) : (
                    <UiLink
                      href={crumb.href}
                      className="truncate underline decoration-border-strong underline-offset-4 hover:text-fg hover:decoration-fg"
                    >
                      {crumb.label}
                    </UiLink>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        ) : eyebrow === undefined ? null : (
          <p className={cn('mb-3', label)}>{eyebrow}</p>
        )}
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="min-w-0 font-display text-3xl font-normal tracking-display text-fg [overflow-wrap:anywhere] sm:text-4xl">
            {title}
          </h1>
          {meta === undefined ? null : <div className="flex flex-wrap items-center gap-2">{meta}</div>}
        </div>
        {description === undefined ? null : (
          <p className="mt-2 max-w-prose text-sm text-fg-muted [overflow-wrap:anywhere]">{description}</p>
        )}
      </div>
      {actions === undefined ? null : <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </header>
  );
}
