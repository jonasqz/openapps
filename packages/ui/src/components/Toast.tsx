'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import { cn } from '../lib/cn.ts';
import { focusRing } from '../lib/focus.ts';
import { strings } from '../strings.ts';

export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

export interface Toast {
  id: string;
  title: string;
  description?: string;
  tone?: ToastTone;
  /**
   * Millisekunden bis zum Verschwinden. `0` bleibt stehen. Vorgabe: 6 s,
   * mit `action` 10 s. Solange die Maus darauf liegt oder der Fokus darin
   * ist, läuft die Zeit nicht (WCAG 2.2.1).
   */
  duration?: number;
  /**
   * Eine Aktion in der Meldung, meist „Undo“ nach einem Widerruf. Ein Klick
   * ruft `onClick` und schließt die Meldung. Die Aktion muss es auch als Tool
   * geben (CLAUDE.md 1); der Knopf ist nur die Abkürzung.
   */
  action?: ToastAction;
}

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastApi {
  show: (toast: Omit<Toast, 'id'> & { id?: string }) => string;
  dismiss: (id: string) => void;
  /** Alle offenen Meldungen — nützlich für Tests. */
  toasts: readonly Toast[];
}

const ToastContext = createContext<ToastApi | null>(null);

/** Höchstzahl gleichzeitig sichtbarer Meldungen; ältere fallen hinten raus. */
export const TOAST_LIMIT = 3;

const TONE: Record<ToastTone, string> = {
  info: 'border-fg bg-fg text-fg-inverted',
  success: 'border-success bg-success-subtle text-success-subtle-fg',
  warning: 'border-warning bg-warning-subtle text-warning-subtle-fg',
  danger: 'border-danger bg-danger-subtle text-danger-subtle-fg',
};

export interface ToastProviderProps {
  children: ReactNode;
  /** Vorbelegte Meldungen — nur für Showcase und Tests. */
  initialToasts?: readonly Toast[];
}

/**
 * Hält die Meldungen und rendert den Bereich am Rand.
 *
 * `aria-live="polite"` plus `role="status"`: eine Meldung unterbricht den
 * Screenreader nicht, wird aber vorgelesen. Fehler-Meldungen tragen zusätzlich
 * `role="alert"`.
 */
export function ToastProvider({ children, initialToasts = [] }: ToastProviderProps): JSX.Element {
  const [toasts, setToasts] = useState<readonly Toast[]>(initialToasts);
  const counter = useRef(0);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const durations = useRef(new Map<string, number>());

  const stop = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const dismiss = useCallback(
    (id: string) => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
      stop(id);
      durations.current.delete(id);
    },
    [stop],
  );

  /** Startet die Zeit (neu). Nach einer Pause läuft die volle Dauer erneut. */
  const start = useCallback(
    (id: string) => {
      const duration = durations.current.get(id) ?? 0;
      if (duration <= 0) return;
      stop(id);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), duration),
      );
    },
    [dismiss, stop],
  );

  const show = useCallback<ToastApi['show']>(
    (input) => {
      counter.current += 1;
      const id = input.id ?? `oa-toast-${counter.current}`;
      const toast: Toast = { ...input, id };
      setToasts((current) => [...current, toast].slice(-TOAST_LIMIT));
      durations.current.set(id, input.duration ?? (input.action === undefined ? 6000 : 10000));
      start(id);
      return id;
    },
    [start],
  );

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) clearTimeout(timer);
      timers.current.clear();
    },
    [],
  );

  const api = useMemo<ToastApi>(() => ({ show, dismiss, toasts }), [show, dismiss, toasts]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-toast flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-0 sm:items-end"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.tone === 'danger' ? 'alert' : 'status'}
            onMouseEnter={() => stop(toast.id)}
            onMouseLeave={() => start(toast.id)}
            onFocus={() => stop(toast.id)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) start(toast.id);
            }}
            className={cn(
              'pointer-events-auto flex w-full min-w-0 max-w-sm animate-oa-slide-in items-start gap-3',
              'rounded-lg border px-4 py-3 shadow-md',
              TONE[toast.tone ?? 'info'],
            )}
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium [overflow-wrap:anywhere]">{toast.title}</p>
              {toast.description === undefined ? null : (
                <p className="mt-0.5 text-sm [overflow-wrap:anywhere]">{toast.description}</p>
              )}
            </div>
            {toast.action === undefined ? null : (
              <button
                type="button"
                onClick={() => {
                  toast.action?.onClick();
                  dismiss(toast.id);
                }}
                className={cn(
                  'shrink-0 self-center rounded-full px-2 py-0.5 text-sm font-semibold underline underline-offset-4 hover:opacity-80',
                  focusRing,
                )}
              >
                {toast.action.label}
              </button>
            )}
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              className={cn('shrink-0 rounded-sm p-0.5 hover:opacity-80', focusRing)}
            >
              <span aria-hidden="true">✕</span>
              <span className="sr-only">{strings.toast.close(toast.title)}</span>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Meldungen zeigen. Wirft, wenn kein `ToastProvider` darüber liegt. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (api === null) {
    throw new Error(strings.developer.toastProviderMissing);
  }
  return api;
}
