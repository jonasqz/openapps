import { useCallback, useId, useRef, useState } from 'react';
import type { JSX, KeyboardEvent, ReactNode } from 'react';
import { cn } from '../lib/cn.ts';
import { focusRingInset } from '../lib/focus.ts';
import { strings } from '../strings.ts';

export interface TabItem {
  id: string;
  label: string;
  /** Kleine Zahl neben dem Namen, z. B. Trefferanzahl. */
  count?: number;
  disabled?: boolean;
  content: ReactNode;
}

export interface TabsProps {
  items: readonly TabItem[];
  /** Ohne Angabe ist der erste nicht deaktivierte Reiter aktiv. */
  defaultTabId?: string;
  /** Gesteuerter Betrieb. */
  tabId?: string;
  onTabChange?: (id: string) => void;
  /** Beschriftung der Reiterleiste für Screenreader. */
  label: string;
  className?: string;
}

/**
 * Reiter nach dem ARIA-Muster „Tabs with manual activation“:
 * Pfeiltasten bewegen den Fokus, Enter/Space wählt. Home/End springen an die
 * Enden. So kann man mit der Tastatur an einem Reiter vorbei, ohne ihn zu laden.
 */
export function Tabs({
  items,
  defaultTabId,
  tabId,
  onTabChange,
  label,
  className,
}: TabsProps): JSX.Element {
  const baseId = useId().replace(/:/g, '');
  const firstEnabled = items.find((item) => item.disabled !== true)?.id ?? items[0]?.id ?? '';
  const [internal, setInternal] = useState(defaultTabId ?? firstEnabled);
  const active = tabId ?? internal;
  const listRef = useRef<HTMLDivElement>(null);

  const select = useCallback(
    (id: string) => {
      if (tabId === undefined) setInternal(id);
      onTabChange?.(id);
    },
    [onTabChange, tabId],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const enabled = items.filter((item) => item.disabled !== true);
    if (enabled.length === 0) return;
    const buttons = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])') ?? [],
    );
    const index = buttons.findIndex((button) => button === document.activeElement);
    const move = (next: number): void => {
      event.preventDefault();
      buttons[(next + buttons.length) % buttons.length]?.focus();
    };
    if (event.key === 'ArrowRight') move(index + 1);
    else if (event.key === 'ArrowLeft') move(index - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(buttons.length - 1);
  };

  if (items.length === 0) {
    return <div className={cn('text-sm text-fg-muted', className)}>{strings.tabs.empty}</div>;
  }

  return (
    <div className={cn('flex min-w-0 flex-col gap-4', className)}>
      <div
        ref={listRef}
        role="tablist"
        aria-label={label}
        aria-orientation="horizontal"
        onKeyDown={onKeyDown}
        className="-mx-1 flex min-w-0 gap-1 overflow-x-auto border-b border-border px-1"
      >
        {items.map((item) => {
          const selected = item.id === active;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`${baseId}-tab-${item.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              onClick={() => select(item.id)}
              className={cn(
                'shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium',
                focusRingInset,
                'disabled:cursor-not-allowed disabled:opacity-50',
                selected
                  ? 'border-primary text-primary'
                  : 'border-transparent text-fg-muted hover:text-fg',
              )}
            >
              {item.label}
              {item.count === undefined ? null : (
                <span className="ml-1.5 rounded-full bg-surface-muted px-1.5 py-0.5 text-xs text-fg-muted">
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {items.map((item) => (
        <div
          key={item.id}
          role="tabpanel"
          id={`${baseId}-panel-${item.id}`}
          aria-labelledby={`${baseId}-tab-${item.id}`}
          hidden={item.id !== active}
          tabIndex={0}
          className="min-w-0 rounded-md outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          {item.id === active ? item.content : null}
        </div>
      ))}
    </div>
  );
}
