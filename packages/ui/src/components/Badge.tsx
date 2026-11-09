import type { HTMLAttributes, JSX, ReactNode } from 'react';
import { cn } from '../lib/cn.ts';

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  /** Zusatztext nur für Screenreader, z. B. „Status: “. */
  srPrefix?: string;
  children: ReactNode;
}

const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-surface-muted text-fg-muted border-border',
  primary: 'bg-primary-subtle text-primary-subtle-fg border-primary-subtle',
  success: 'bg-success-subtle text-success-subtle-fg border-success-subtle',
  warning: 'bg-warning-subtle text-warning-subtle-fg border-warning-subtle',
  danger: 'bg-danger-subtle text-danger-subtle-fg border-danger-subtle',
};

/**
 * Status-Etikett. Farbe ist nie die einzige Information — der Text trägt die
 * Bedeutung, die Farbe verstärkt sie nur.
 */
export function Badge({ tone = 'neutral', srPrefix, className, children, ...rest }: BadgeProps): JSX.Element {
  return (
    <span
      {...rest}
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5',
        'text-xs font-medium',
        'truncate',
        TONE[tone],
        className,
      )}
    >
      {srPrefix === undefined ? null : <span className="sr-only">{srPrefix}</span>}
      {children}
    </span>
  );
}
