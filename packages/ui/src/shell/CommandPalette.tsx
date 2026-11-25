'use client';

import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { JSX, KeyboardEvent, ReactNode } from 'react';
import { cn } from '../lib/cn.ts';
import { trapFocus } from '../lib/focus.ts';
import { Icon } from '../components/Icon.tsx';
import { Kbd } from '../components/Kbd.tsx';
import { strings } from '../strings.ts';

export interface CommandItem {
  id: string;
  label: string;
  href: string;
  /** Überschrift, unter der der Eintrag steht. */
  group?: string;
  /** Kleiner Zusatz rechts, z. B. der Pfad. Wird mit durchsucht. */
  hint?: string;
  icon?: ReactNode;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  items: readonly CommandItem[];
  onSelect: (item: CommandItem) => void;
}

/** Treffer zuerst, die mit dem Suchwort beginnen; sonst Reihenfolge wie gegeben. */
export function filterCommands(items: readonly CommandItem[], query: string): CommandItem[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [...items];
  const scored: Array<[number, number, CommandItem]> = [];
  items.forEach((item, index) => {
    const label = item.label.toLowerCase();
    const rest = `${item.group ?? ''} ${item.hint ?? ''}`.toLowerCase();
    if (label.startsWith(q)) scored.push([0, index, item]);
    else if (label.includes(q)) scored.push([1, index, item]);
    else if (rest.includes(q)) scored.push([2, index, item]);
  });
  return scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, , item]) => item);
}

/**
 * Befehlspalette: Springen per Tastatur zu jeder Seite und App.
 *
 * Muster „combobox mit listbox": Der Fokus bleibt im Suchfeld, Pfeiltasten
 * bewegen die Auswahl (`aria-activedescendant`), Enter öffnet, Escape
 * schließt. Die Shell öffnet sie mit ⌘K bzw. Strg+K.
 */
export function CommandPalette({
  open,
  onClose,
  items,
  onSelect,
}: CommandPaletteProps): JSX.Element | null {
  const baseId = useId().replace(/:/g, '');
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  const results = useMemo(() => filterCommands(items, query), [items, query]);

  useEffect(() => {
    if (!open) return undefined;
    restoreTo.current = document.activeElement as HTMLElement | null;
    setQuery('');
    setActive(0);
    const panel = panelRef.current;
    const untrap = panel === null ? () => undefined : trapFocus(panel);
    inputRef.current?.focus();
    return () => {
      untrap();
      restoreTo.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    document.getElementById(`${baseId}-opt-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, baseId]);

  if (!open) return null;

  const choose = (item: CommandItem | undefined): void => {
    if (item === undefined) return;
    onClose();
    onSelect(item);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((value) => (results.length === 0 ? 0 : (value + 1) % results.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((value) =>
        results.length === 0 ? 0 : (value - 1 + results.length) % results.length,
      );
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(results[active]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  let lastGroup: string | undefined;

  return (
    <div className="fixed inset-0 z-dialog flex items-start justify-center px-4 pt-[12vh]">
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 animate-oa-fade-in bg-overlay"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={strings.commandPalette.label}
        className="relative flex max-h-[70vh] w-full max-w-lg min-w-0 animate-oa-slide-in flex-col overflow-hidden rounded-lg border border-border bg-bg shadow-lg"
      >
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Icon name="search" className="text-fg-subtle" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={`${baseId}-list`}
            aria-activedescendant={results.length === 0 ? undefined : `${baseId}-opt-${active}`}
            aria-autocomplete="list"
            aria-label={strings.commandPalette.label}
            placeholder={strings.commandPalette.placeholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            className="h-12 min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle focus-visible:outline-none"
          />
          <Kbd>{strings.commandPalette.escapeKey}</Kbd>
        </div>
        <ul
          id={`${baseId}-list`}
          role="listbox"
          aria-label={strings.commandPalette.label}
          className="min-h-0 overflow-y-auto p-1.5"
        >
          {results.length === 0 ? (
            <li role="presentation" className="px-3 py-8 text-center text-sm text-fg-muted">
              {strings.commandPalette.empty}
            </li>
          ) : (
            results.map((item, index) => {
              const group = item.group ?? strings.commandPalette.navigationGroup;
              const heading =
                group === lastGroup ? null : (
                  <li
                    role="presentation"
                    className="px-3 pb-1 pt-3 font-mono text-2xs font-medium uppercase tracking-label text-fg-muted first:pt-1.5"
                  >
                    {group}
                  </li>
                );
              lastGroup = group;
              const selected = index === active;
              return (
                <Fragment key={item.id}>
                  {heading}
                  <li
                    id={`${baseId}-opt-${index}`}
                    role="option"
                    aria-selected={selected}
                    onMouseMove={() => setActive(index)}
                    onClick={() => choose(item)}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-sm px-3 py-2 text-sm',
                      selected
                        ? "relative bg-surface-hover text-fg before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:bg-primary before:content-['']"
                        : 'text-fg-muted',
                    )}
                  >
                    {item.icon === undefined ? null : <span aria-hidden="true">{item.icon}</span>}
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.hint === undefined ? null : (
                      <span className="shrink-0 truncate font-mono text-2xs text-fg-subtle">
                        {item.hint}
                      </span>
                    )}
                  </li>
                </Fragment>
              );
            })
          )}
        </ul>
        <p className="border-t border-border px-4 py-2 font-mono text-2xs text-fg-subtle">
          {strings.commandPalette.hint}
        </p>
      </div>
    </div>
  );
}
