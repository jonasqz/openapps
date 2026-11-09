'use client';

import { useEffect, useId, useRef } from 'react';
import type { JSX, ReactNode } from 'react';
import { cn } from '../lib/cn.ts';
import { focusRing } from '../lib/focus.ts';
import { focusable, trapFocus } from '../lib/focus.ts';
import { strings } from '../strings.ts';

export interface DialogProps {
  open: boolean;
  /** Escape, Klick auf die Abdunklung und der Schließen-Knopf rufen das auf. */
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  /** Knöpfe unten. Die Hauptaktion steht zuletzt. */
  footer?: ReactNode;
  /** `alertdialog`, wenn eine Entscheidung erzwungen wird (Löschen). */
  role?: 'dialog' | 'alertdialog';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' } as const;

/**
 * Modaler Dialog.
 *
 * - Fokus wandert beim Öffnen in den Dialog und beim Schließen zurück auf das
 *   Element, das ihn geöffnet hat.
 * - Fokus bleibt im Dialog gefangen (`trapFocus`).
 * - Escape schließt, der Hintergrund scrollt nicht mit.
 * - Auf Phone-Breite sitzt der Dialog unten und füllt die Breite.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  role = 'dialog',
  size = 'md',
  className,
}: DialogProps): JSX.Element | null {
  const baseId = useId().replace(/:/g, '');
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    restoreTo.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    if (panel === null) return undefined;

    const untrap = trapFocus(panel);
    const items = focusable(panel);
    (items[0] ?? panel).focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      untrap();
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      restoreTo.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-dialog flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 animate-oa-fade-in bg-overlay"
      />
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={`${baseId}-title`}
        aria-describedby={description === undefined ? undefined : `${baseId}-desc`}
        tabIndex={-1}
        className={cn(
          'relative flex max-h-[90vh] w-full min-w-0 animate-oa-slide-in flex-col',
          'rounded-t-xl border border-border bg-bg shadow-lg sm:rounded-xl',
          SIZE[size],
          className,
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0">
            <h2 id={`${baseId}-title`} className="text-base font-semibold text-fg [overflow-wrap:anywhere]">
              {title}
            </h2>
            {description === undefined ? null : (
              <p id={`${baseId}-desc`} className="mt-1 text-sm text-fg-muted [overflow-wrap:anywhere]">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className={cn(
              'shrink-0 rounded-md p-1 text-fg-muted hover:bg-surface-hover hover:text-fg',
              focusRing,
            )}
          >
            <span aria-hidden="true">✕</span>
            <span className="sr-only">{strings.dialog.close}</span>
          </button>
        </div>
        {children === undefined ? null : (
          <div className="min-w-0 overflow-y-auto p-4">{children}</div>
        )}
        {footer === undefined ? null : (
          <div className="flex flex-wrap justify-end gap-2 border-t border-border p-4">{footer}</div>
        )}
      </div>
    </div>
  );
}
