import type { JSX, ReactNode } from 'react';
import { cn } from '../lib/cn.ts';
import { strings } from '../strings.ts';

export interface FieldShellProps {
  inputId: string;
  label: string;
  /** Hilfetext unter dem Feld. Verschwindet nicht, wenn ein Fehler erscheint. */
  hint?: string;
  hintId: string;
  /** Fehlermeldung. Sichtbar am Feld, nicht nur in einem Toast. */
  error?: string;
  errorId: string;
  required?: boolean;
  /** Label nur für Screenreader (z. B. Filterfeld mit Lupe daneben). */
  hideLabel?: boolean;
  children: ReactNode;
  className?: string | undefined;
}

/**
 * Gemeinsame Hülle für alle Formularfelder: Label, Hilfetext und sichtbare
 * Fehlermeldung direkt am Feld. Regel 6 aus `AGENTS.md` lebt hier.
 */
export function FieldShell({
  inputId,
  label,
  hint,
  hintId,
  error,
  errorId,
  required = false,
  hideLabel = false,
  children,
  className,
}: FieldShellProps): JSX.Element {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <label
        htmlFor={inputId}
        className={cn('text-sm font-medium text-fg', hideLabel && 'sr-only')}
      >
        {label}
        {required ? (
          <>
            <span aria-hidden="true" className="ml-0.5 text-danger">
              *
            </span>
            <span className="sr-only">{strings.common.requiredSuffix}</span>
          </>
        ) : null}
      </label>
      {children}
      {hint === undefined ? null : (
        <p id={hintId} className="text-xs text-fg-muted [overflow-wrap:anywhere]">
          {hint}
        </p>
      )}
      {error === undefined ? null : (
        <p
          id={errorId}
          role="alert"
          className="flex items-start gap-1 text-xs font-medium text-danger [overflow-wrap:anywhere]"
        >
          <span aria-hidden="true">⚠</span>
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

/** Beschreibende IDs zusammensetzen — leer wird zu `undefined`, nicht zu "". */
export function describedBy(ids: Array<string | false | undefined>): string | undefined {
  const used = ids.filter((id): id is string => typeof id === 'string' && id.length > 0);
  return used.length > 0 ? used.join(' ') : undefined;
}

export const controlBase =
  'w-full min-w-0 rounded-md border bg-bg px-3 text-sm text-fg placeholder:text-fg-subtle ' +
  'disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-fg-subtle';

export const controlBorder = (hasError: boolean): string =>
  hasError ? 'border-danger' : 'border-border-strong';
