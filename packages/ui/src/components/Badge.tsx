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
  neutral: 'bg-surface text-fg-muted border-border',
  primary: 'bg-primary-subtle text-primary-subtle-fg border-primary-subtle',
  success: 'bg-success-subtle text-success-subtle-fg border-success-subtle',
  warning: 'bg-warning-subtle text-warning-subtle-fg border-warning-subtle',
  danger: 'bg-danger-subtle text-danger-subtle-fg border-danger-subtle',
};

/**
 * Status-Etikett: Mono in Versalien mit einem kleinen Quadrat in Textfarbe.
 * Farbe ist nie die einzige Information — der Text trägt die
 * Bedeutung, die Farbe verstärkt sie nur.
 */
export function Badge({ tone = 'neutral', srPrefix, className, children, ...rest }: BadgeProps): JSX.Element {
  return (
    <span
      {...rest}
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-sm border px-1.5 py-0.5',
        'font-mono text-2xs font-medium uppercase tracking-label',
        "min-w-0 before:h-1.5 before:w-1.5 before:shrink-0 before:bg-current before:content-['']",
        TONE[tone],
        className,
      )}
    >
      {srPrefix === undefined ? null : <span className="sr-only">{srPrefix}</span>}
      <span className="min-w-0 [overflow-wrap:break-word]">{children}</span>
    </span>
  );
}
