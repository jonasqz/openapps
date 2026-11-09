'use client';

import { forwardRef } from 'react';
import type { InputHTMLAttributes, JSX } from 'react';
import { cn } from '../lib/cn.ts';
import { focusRing } from '../lib/focus.ts';
import { useFieldIds } from '../lib/useId.ts';
import { describedBy } from './Field.tsx';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'> {
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  fieldClassName?: string;
}

/**
 * Kontrollkästchen. Nativer Input mit `accent-color` über das Token, damit
 * Tastatur, Fokus und Screenreader unverändert funktionieren.
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, hint, error, className, fieldClassName, id, ...rest },
  ref,
): JSX.Element {
  const ids = useFieldIds(id);
  const hasError = error !== undefined;
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', fieldClassName)}>
      <div className="flex items-start gap-2">
        <input
          {...rest}
          ref={ref}
          type="checkbox"
          id={ids.inputId}
          aria-invalid={hasError || undefined}
          aria-describedby={describedBy([hint !== undefined && ids.hintId, hasError && ids.errorId])}
          className={cn(
            'mt-0.5 h-4 w-4 shrink-0 rounded-sm border accent-primary',
            hasError ? 'border-danger' : 'border-border-strong',
            'disabled:cursor-not-allowed disabled:opacity-50',
            focusRing,
            className,
          )}
        />
        <label htmlFor={ids.inputId} className="min-w-0 text-sm text-fg [overflow-wrap:anywhere]">
          {label}
        </label>
      </div>
      {hint === undefined ? null : (
        <p id={ids.hintId} className="pl-6 text-xs text-fg-muted">
          {hint}
        </p>
      )}
      {error === undefined ? null : (
        <p id={ids.errorId} role="alert" className="pl-6 text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
});
