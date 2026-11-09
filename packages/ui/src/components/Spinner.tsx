import type { JSX } from 'react';
import { cn } from '../lib/cn.ts';
import { strings } from '../strings.ts';

export interface SpinnerProps {
  /** `sm` passt in einen Button, `lg` in einen leeren Bereich. */
  size?: 'sm' | 'md' | 'lg';
  /**
   * Was gerade lädt. Wird Screenreadern angekündigt.
   * `null` für einen Spinner, der neben einem eigenen Lade-Text sitzt.
   */
  label?: string | null;
  className?: string;
}

const SIZE = {
  sm: 'h-4 w-4 border-2',
  md: 'h-6 w-6 border-2',
  lg: 'h-10 w-10 border-2',
} as const;

/** Ladeanzeige. Respektiert `prefers-reduced-motion` über die Token-CSS. */
export function Spinner({ size = 'md', label, className }: SpinnerProps): JSX.Element {
  const text = label === undefined ? strings.common.loading : label;
  return (
    <span
      className={cn('inline-flex items-center gap-2', className)}
      role="status"
      aria-live="polite"
    >
      <span
        aria-hidden="true"
        className={cn(
          'inline-block shrink-0 animate-oa-spin rounded-full border-border-strong border-t-transparent',
          SIZE[size],
        )}
      />
      {text === null ? null : <span className="sr-only">{text}</span>}
    </span>
  );
}
