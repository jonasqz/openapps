'use client';

import { forwardRef } from 'react';
import type { InputHTMLAttributes, JSX } from 'react';
import { cn } from '../lib/cn.ts';
import { focusRing } from '../lib/focus.ts';
import { useFieldIds } from '../lib/useId.ts';
import { FieldShell, controlBase, controlBorder, describedBy } from './Field.tsx';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> {
  label: string;
  hint?: string;
  /** Sichtbare Fehlermeldung am Feld; setzt zugleich `aria-invalid`. */
  error?: string;
  hideLabel?: boolean;
  className?: string;
  /** Klassen für das umgebende Feld (Breite, Spalten). */
  fieldClassName?: string;
}

/** Einzeiliges Textfeld mit Label, Hilfetext und sichtbarer Fehlermeldung. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, hideLabel = false, className, fieldClassName, id, required, ...rest },
  ref,
): JSX.Element {
  const ids = useFieldIds(id);
  const hasError = error !== undefined;
  return (
    <FieldShell
      inputId={ids.inputId}
      label={label}
      hintId={ids.hintId}
      errorId={ids.errorId}
      hideLabel={hideLabel}
      className={fieldClassName}
      {...(hint === undefined ? {} : { hint })}
      {...(error === undefined ? {} : { error })}
      {...(required === undefined ? {} : { required })}
    >
      <input
        {...rest}
        ref={ref}
        id={ids.inputId}
        required={required}
        aria-invalid={hasError || undefined}
        aria-describedby={describedBy([hint !== undefined && ids.hintId, hasError && ids.errorId])}
        className={cn(controlBase, controlBorder(hasError), 'h-10', focusRing, className)}
      />
    </FieldShell>
  );
});
