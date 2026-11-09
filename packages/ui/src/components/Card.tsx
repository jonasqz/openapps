import type { HTMLAttributes, JSX, ReactNode } from 'react';
import { cn } from '../lib/cn.ts';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

/** Fläche für zusammengehörige Inhalte. Keine eigene Farbe, nur Tokens. */
export function Card({ className, children, ...rest }: CardProps): JSX.Element {
  return (
    <div
      {...rest}
      className={cn(
        'flex min-w-0 flex-col rounded-lg border border-border bg-surface shadow-sm',
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface CardHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: ReactNode;
  description?: ReactNode;
  /** Knöpfe rechts. Bricht auf Phone-Breite unter den Titel. */
  actions?: ReactNode;
  /** Überschriftsebene — die Seite bestimmt sie, nicht die Komponente. */
  as?: 'h2' | 'h3' | 'h4';
}

export function CardHeader({
  title,
  description,
  actions,
  as: Heading = 'h2',
  className,
  ...rest
}: CardHeaderProps): JSX.Element {
  return (
    <div
      {...rest}
      className={cn(
        'flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-start sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0">
        <Heading className="truncate text-base font-semibold text-fg">{title}</Heading>
        {description === undefined ? null : (
          <p className="mt-1 text-sm text-fg-muted [overflow-wrap:anywhere]">{description}</p>
        )}
      </div>
      {actions === undefined ? null : (
        <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
      )}
    </div>
  );
}

export function CardBody({ className, children, ...rest }: CardProps): JSX.Element {
  return (
    <div {...rest} className={cn('min-w-0 break-words p-4 [overflow-wrap:anywhere]', className)}>
      {children}
    </div>
  );
}

export function CardFooter({ className, children, ...rest }: CardProps): JSX.Element {
  return (
    <div
      {...rest}
      className={cn('flex flex-wrap gap-2 border-t border-border p-4', className)}
    >
      {children}
    </div>
  );
}
