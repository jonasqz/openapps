import { useEffect, useId, useRef, useState } from 'react';
import type { JSX } from 'react';
import { cn } from '../lib/cn.ts';
import { focusRing } from '../lib/focus.ts';
import { EmptyState } from '../components/EmptyState.tsx';
import { ErrorState } from '../components/ErrorState.tsx';
import { Spinner } from '../components/Spinner.tsx';
import type { ShellNotification } from './types.ts';
import { strings } from '../strings.ts';

export interface NotificationBellProps {
  notifications: readonly ShellNotification[];
  loading?: boolean;
  error?: string;
  onOpen?: (notification: ShellNotification) => void;
  onMarkAllRead?: () => void;
  className?: string;
}

/**
 * Benachrichtigungen.
 *
 * Die Zahl ungelesener Meldungen steht auch im `aria-label` — die rote Scheibe
 * allein wäre für Screenreader stumm. Hat alle Zustände: lädt, Fehler, leer.
 */
export function NotificationBell({
  notifications,
  loading = false,
  error,
  onOpen,
  onMarkAllRead,
  className,
}: NotificationBellProps): JSX.Element {
  const baseId = useId().replace(/:/g, '');
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const unread = notifications.filter((item) => item.read !== true).length;

  useEffect(() => {
    if (!open) return undefined;
    const onDocumentClick = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) === true || buttonRef.current?.contains(target) === true) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDocumentClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocumentClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className={cn('relative', className)}>
      <button
        ref={buttonRef}
        type="button"
        id={`${baseId}-button`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={strings.notifications.label(unread)}
        onClick={() => setOpen((value) => !value)}
        className={cn('relative rounded-md p-2 text-fg-muted hover:bg-surface-hover hover:text-fg', focusRing)}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M10 3a4 4 0 0 0-4 4v3l-1.5 3h11L14 10V7a4 4 0 0 0-4-4Z" strokeLinejoin="round" />
          <path d="M8 16a2 2 0 0 0 4 0" strokeLinecap="round" />
        </svg>
        {unread > 0 ? (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-xs font-semibold text-danger-fg"
          >
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-label={strings.notifications.title}
          className="absolute right-0 top-full z-dropdown mt-1 w-panel max-w-[calc(100vw-2rem)] animate-oa-fade-in rounded-lg border border-border bg-bg shadow-lg"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <h2 className="text-sm font-semibold text-fg">{strings.notifications.title}</h2>
            {onMarkAllRead === undefined || unread === 0 ? null : (
              <button
                type="button"
                onClick={onMarkAllRead}
                className={cn('rounded-sm text-xs font-medium text-primary hover:underline', focusRing)}
              >
                {strings.notifications.markAllRead}
              </button>
            )}
          </div>
          <div className="max-h-scroll overflow-y-auto p-2">
            {loading ? (
              <div className="flex justify-center p-4">
                <Spinner label={strings.notifications.loading} />
              </div>
            ) : error !== undefined ? (
              <ErrorState title={strings.notifications.errorTitle} description={error} />
            ) : notifications.length === 0 ? (
              <EmptyState
                title={strings.notifications.emptyTitle}
                description={strings.notifications.emptyDescription}
              />
            ) : (
              <ul className="flex flex-col gap-1">
                {notifications.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        onOpen?.(item);
                      }}
                      className={cn(
                        'flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left hover:bg-surface-hover',
                        focusRing,
                      )}
                    >
                      <span className="flex w-full min-w-0 items-center gap-2">
                        {item.read === true ? null : (
                          <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                        )}
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
                          {item.title}
                        </span>
                        {item.read === true ? null : (
                        <span className="sr-only">{strings.notifications.unreadSuffix}</span>
                      )}
                      </span>
                      {item.body === undefined ? null : (
                        <span className="line-clamp-2 text-xs text-fg-muted">{item.body}</span>
                      )}
                      {item.at === undefined ? null : (
                        <span className="text-xs text-fg-subtle">{item.at}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
