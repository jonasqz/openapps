'use client';

import { forwardRef } from 'react';
import type { JSX, TextareaHTMLAttributes } from 'react';
import { cn } from '../lib/cn.ts';
import { focusRing } from '../lib/focus.ts';
import { useFieldIds } from '../lib/useId.ts';
import { FieldShell, controlBase, controlBorder, describedBy } from './Field.tsx';

export interface TextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> {
  label: string;
  hint?: string;
  /** Sichtbare Fehlermeldung am Feld; setzt zugleich `aria-invalid`. */
  error?: string;
  hideLabel?: boolean;
  /** Schrift in Festbreite, etwa für Markdown oder Code. */
  monospace?: boolean;
  className?: string;
  /** Klassen für das umgebende Feld (Breite, Spalten). */
  fieldClassName?: string;
}

/** Mehrzeiliges Textfeld mit Label, Hilfetext und sichtbarer Fehlermeldung. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    label,
    hint,
    error,
    hideLabel = false,
    monospace = false,
    className,
    fieldClassName,
    id,
    required,
    rows = 6,
    ...rest
  },
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
      <textarea
        {...rest}
        ref={ref}
        id={ids.inputId}
        rows={rows}
        required={required}
        aria-invalid={hasError || undefined}
        aria-describedby={describedBy([hint !== undefined && ids.hintId, hasError && ids.errorId])}
        className={cn(
          controlBase,
          controlBorder(hasError),
          'py-2 leading-relaxed',
          monospace && 'font-mono',
          focusRing,
          className,
        )}
      />
    </FieldShell>
  );
});
