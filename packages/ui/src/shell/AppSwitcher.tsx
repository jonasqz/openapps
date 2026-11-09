import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { cn } from '../lib/cn.ts';
import { focusRing } from '../lib/focus.ts';
import type { ShellApp } from './types.ts';
import { strings } from '../strings.ts';

export interface AppSwitcherProps {
  apps: readonly ShellApp[];
  /** Name der aktuellen App, falls keine `current`-Markierung gesetzt ist. */
  currentName?: string;
  onNavigate?: (app: ShellApp) => void;
  className?: string;
}

/**
 * App-Wechsler als Menü-Knopf.
 *
 * Tastatur: Enter/Space und Pfeil-ab öffnen, Pfeiltasten wandern, Escape
 * schließt und gibt den Fokus an den Knopf zurück, Tab verlässt das Menü.
 * Gruppiert nach Kategorie, damit zwanzig Apps nicht zu einer Wand werden.
 */
export function AppSwitcher({ apps, currentName, onNavigate, className }: AppSwitcherProps): JSX.Element {
  const baseId = useId().replace(/:/g, '');
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const current = apps.find((app) => app.current === true);
  const label = current?.name ?? currentName ?? strings.appSwitcher.placeholder;

  const groups = useMemo(() => {
    const byCategory = new Map<string, ShellApp[]>();
    for (const app of apps) {
      const key = app.category ?? strings.appSwitcher.defaultCategory;
      const list = byCategory.get(key) ?? [];
      list.push(app);
      byCategory.set(key, list);
    }
    return Array.from(byCategory.entries()).sort(([a], [b]) => a.localeCompare(b, 'de'));
  }, [apps]);

  useEffect(() => {
    if (!open) return undefined;
    const onDocumentClick = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) === true || buttonRef.current?.contains(target) === true) return;
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
    const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    items?.[0]?.focus();
    return () => {
      document.removeEventListener('mousedown', onDocumentClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const moveFocus = (delta: number): void => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    if (items.length === 0) return;
    const index = items.findIndex((item) => item === document.activeElement);
    items[(index + delta + items.length) % items.length]?.focus();
  };

  return (
    <div className={cn('relative min-w-0', className)}>
      <button
        ref={buttonRef}
        type="button"
        id={`${baseId}-button`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${baseId}-menu` : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          'flex min-w-0 max-w-full items-center gap-2 rounded-md border border-border bg-surface',
          'px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-hover',
          focusRing,
        )}
      >
        <span className="truncate">{label}</span>
        <span aria-hidden="true" className="shrink-0 text-fg-muted">
          ▾
        </span>
        <span className="sr-only">{strings.appSwitcher.action}</span>
      </button>

      {open ? (
        <div
          ref={menuRef}
          role="menu"
          id={`${baseId}-menu`}
          aria-labelledby={`${baseId}-button`}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              moveFocus(1);
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              moveFocus(-1);
            }
          }}
          className={cn(
            'absolute left-0 top-full z-dropdown mt-1 max-h-scroll w-menu max-w-[calc(100vw-2rem)] overflow-y-auto',
            'animate-oa-fade-in rounded-lg border border-border bg-bg p-1 shadow-lg',
          )}
        >
          {apps.length === 0 ? (
            <p className="px-3 py-2 text-sm text-fg-muted">{strings.appSwitcher.empty}</p>
          ) : (
            groups.map(([category, list]) => (
              <div key={category} role="group" aria-label={category}>
                <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
                  {category}
                </p>
                {list.map((app) => (
                  <a
                    key={app.id}
                    role="menuitem"
                    href={app.href}
                    aria-current={app.current === true ? 'page' : undefined}
                    onClick={(event) => {
                      if (onNavigate !== undefined) {
                        event.preventDefault();
                        onNavigate(app);
                      }
                      setOpen(false);
                    }}
                    className={cn(
                      'flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm',
                      focusRing,
                      app.current === true
                        ? 'bg-primary-subtle font-medium text-primary-subtle-fg'
                        : 'text-fg hover:bg-surface-hover',
                    )}
                  >
                    <span className="truncate">{app.name}</span>
                    {app.current === true ? (
                      <span aria-hidden="true" className="shrink-0">
                        ✓
                      </span>
                    ) : null}
                  </a>
                ))}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
