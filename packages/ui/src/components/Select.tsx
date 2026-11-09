'use client';

import { forwardRef } from 'react';
import type { JSX, SelectHTMLAttributes } from 'react';
import { cn } from '../lib/cn.ts';
import { focusRing } from '../lib/focus.ts';
import { useFieldIds } from '../lib/useId.ts';
import { FieldShell, controlBase, controlBorder, describedBy } from './Field.tsx';
import { strings } from '../strings.ts';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children' | 'className'> {
  label: string;
  options: readonly SelectOption[];
  /** Erster, nicht wählbarer Eintrag — ersetzt den fehlenden Placeholder. */
  placeholder?: string;
  hint?: string;
  error?: string;
  hideLabel?: boolean;
  /** Text, wenn `options` leer ist. Das Feld bleibt dann deaktiviert. */
  emptyLabel?: string;
  className?: string;
  fieldClassName?: string;
}

/**
 * Auswahlfeld auf Basis des nativen `<select>`: Tastatur, Screenreader und
 * das Bedienfeld des Betriebssystems kommen gratis. Ein eigenes Listbox-Menü
 * wäre mehr Code und schlechter bedienbar.
 *
 * Zustände: leer (keine Optionen), sehr viele Optionen (das native Menü
 * scrollt selbst), Fehler, deaktiviert.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    label,
    options,
    placeholder,
    hint,
    error,
    hideLabel = false,
    emptyLabel,
    className,
    fieldClassName,
    id,
    required,
    disabled,
    ...rest
  },
  ref,
): JSX.Element {
  const ids = useFieldIds(id);
  const hasError = error !== undefined;
  const isEmpty = options.length === 0;
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
      <select
        {...rest}
        ref={ref}
        id={ids.inputId}
        required={required}
        disabled={disabled === true || isEmpty}
        aria-invalid={hasError || undefined}
        aria-describedby={describedBy([hint !== undefined && ids.hintId, hasError && ids.errorId])}
        className={cn(controlBase, controlBorder(hasError), 'h-10 pr-8', focusRing, className)}
      >
        {isEmpty ? (
          <option value="">{emptyLabel ?? strings.select.empty}</option>
        ) : (
          <>
            {placeholder === undefined ? null : (
              <option value="" disabled>
                {placeholder}
              </option>
            )}
            {options.map((option) => (
              <option key={option.value} value={option.value} disabled={option.disabled}>
                {option.label}
              </option>
            ))}
          </>
        )}
      </select>
    </FieldShell>
  );
});
