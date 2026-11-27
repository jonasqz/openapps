'use client';

import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { JSX, KeyboardEvent, ReactNode } from 'react';
import { cn } from '../lib/cn.ts';
import { trapFocus } from '../lib/focus.ts';
import { Icon } from '../components/Icon.tsx';
import { Kbd } from '../components/Kbd.tsx';
import { Spinner } from '../components/Spinner.tsx';
import { strings } from '../strings.ts';
import {
  PLATFORM_SEARCH_DEBOUNCE_MS,
  PLATFORM_SEARCH_MIN_QUERY,
  plainSnippet,
  type PlatformSearch,
  type PlatformSearchFailure,
  type PlatformSearchGroup,
} from './platform-search.ts';

export interface CommandItem {
  id: string;
  label: string;
  href: string;
  /** Überschrift, unter der der Eintrag steht. */
  group?: string;
  /** Kleiner Zusatz rechts, z. B. der Pfad. Wird mit durchsucht. */
  hint?: string;
  /** Zweite Zeile unter dem Namen, z. B. der Ausschnitt eines Suchtreffers. */
  description?: string;
  icon?: ReactNode;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  items: readonly CommandItem[];
  onSelect: (item: CommandItem) => void;
  /**
   * Die Suche über alle Apps (ADR 0021). Ohne sie springt die Palette nur zu
   * Seiten und Apps. Mit ihr fragt sie ab zwei Zeichen, entprellt, die Apps
   * und zeigt die Treffer nach App gruppiert unter den Sprungzielen.
   */
  search?: PlatformSearch;
}

/** Wo die Suche über alle Apps gerade steht. */
type RemoteState =
  | { status: 'idle' }
  | { status: 'loading' }
  | {
      status: 'done';
      groups: readonly PlatformSearchGroup[];
      failed: readonly PlatformSearchFailure[];
    }
  | { status: 'error' };

const IDLE: RemoteState = { status: 'idle' };

/** Treffer der Suche als Einträge der Palette, gruppiert nach App. */
function remoteItems(state: RemoteState): CommandItem[] {
  if (state.status !== 'done') return [];
  return state.groups.flatMap((group) =>
    group.hits.map((hit) => ({
      id: `search:${group.app}:${hit.id}`,
      label: hit.title,
      href: hit.href,
      group: group.title,
      ...(hit.kind === undefined ? {} : { hint: hit.kind }),
      ...(hit.snippet === undefined ? {} : { description: plainSnippet(hit.snippet) }),
    })),
  );
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
  search,
}: CommandPaletteProps): JSX.Element | null {
  const baseId = useId().replace(/:/g, '');
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [remote, setRemote] = useState<RemoteState>(IDLE);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  const results = useMemo(() => filterCommands(items, query), [items, query]);
  const found = useMemo(() => remoteItems(remote), [remote]);
  // Eine Liste für die Tastatur: erst die Sprungziele, dann die Treffer.
  const options = useMemo(() => [...results, ...found], [results, found]);
  const searching = search !== undefined && query.trim().length >= PLATFORM_SEARCH_MIN_QUERY;

  // Die Suche über alle Apps: entprellt, ab zwei Zeichen, eine Anfrage zur
  // Zeit. Eine ältere Antwort, die nach einer neueren kommt, wird verworfen.
  useEffect(() => {
    if (!open || search === undefined) return undefined;
    const text = query.trim();
    if (text.length < PLATFORM_SEARCH_MIN_QUERY) {
      setRemote(IDLE);
      return undefined;
    }
    setRemote({ status: 'loading' });
    const controller = new AbortController();
    const timer = setTimeout(() => {
      search(text, controller.signal).then(
        (response) => {
          if (controller.signal.aborted) return;
          setRemote({ status: 'done', groups: response.results, failed: response.failed });
        },
        () => {
          if (controller.signal.aborted) return;
          setRemote({ status: 'error' });
        },
      );
    }, PLATFORM_SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, query, search]);

  // Kommen Treffer dazu oder fallen weg, bleibt die Auswahl in der Liste.
  useEffect(() => {
    setActive((value) => (value < options.length ? value : 0));
  }, [options.length]);

  useEffect(() => {
    if (!open) return undefined;
    restoreTo.current = document.activeElement as HTMLElement | null;
    setQuery('');
    setActive(0);
    setRemote(IDLE);
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
      setActive((value) => (options.length === 0 ? 0 : (value + 1) % options.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((value) =>
        options.length === 0 ? 0 : (value - 1 + options.length) % options.length,
      );
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(options[active]);
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
            aria-activedescendant={options.length === 0 ? undefined : `${baseId}-opt-${active}`}
            aria-autocomplete="list"
            aria-label={strings.commandPalette.label}
            placeholder={
              search === undefined
                ? strings.commandPalette.placeholder
                : strings.commandPalette.searchPlaceholder
            }
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
          {results.length === 0 && !searching ? (
            <li role="presentation" className="px-3 py-8 text-center text-sm text-fg-muted">
              {strings.commandPalette.empty}
            </li>
          ) : null}
          {options.map((item, index) => {
            const group = item.group ?? strings.commandPalette.navigationGroup;
            // Am Übergang zu den Treffern immer eine neue Überschrift, auch
            // wenn die App so heißt wie die letzte Gruppe der Sprungziele.
            const boundary = index === results.length;
            const heading =
              group === lastGroup && !boundary ? null : (
                <li
                  role="presentation"
                  className={cn(
                    'px-3 pb-1 pt-3 font-mono text-2xs font-medium uppercase tracking-label text-fg-muted first:pt-1.5',
                    boundary && index > 0 ? 'mt-1.5 border-t border-border' : null,
                  )}
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
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{item.label}</span>
                    {item.description === undefined ? null : (
                      <span className="truncate text-xs text-fg-subtle">{item.description}</span>
                    )}
                  </span>
                  {item.hint === undefined ? null : (
                    <span className="shrink-0 truncate font-mono text-2xs text-fg-subtle">
                      {item.hint}
                    </span>
                  )}
                </li>
              </Fragment>
            );
          })}
          {searching ? <SearchStatus state={remote} /> : null}
        </ul>
        <p className="border-t border-border px-4 py-2 font-mono text-2xs text-fg-subtle">
          {strings.commandPalette.hint}
        </p>
      </div>
    </div>
  );
}

/**
 * Lade-, Leer- und Fehlerzustand der Suche über alle Apps, unter den
 * Treffern. Eine App, die nicht antwortet, steht hier mit Namen; die
 * anderen Treffer bleiben stehen.
 */
function SearchStatus({ state }: { state: RemoteState }): JSX.Element | null {
  const row = 'flex gap-2 px-3 py-2 text-xs';
  if (state.status === 'loading' || state.status === 'idle') {
    return (
      <li role="presentation" className={cn(row, 'items-center text-fg-muted')}>
        <Spinner size="sm" label={null} />
        <span role="status">{strings.commandPalette.searching}</span>
      </li>
    );
  }
  if (state.status === 'error') {
    return (
      <li role="presentation" className={cn(row, 'items-center text-danger')}>
        <span role="alert">{strings.commandPalette.searchError}</span>
      </li>
    );
  }
  const empty = state.groups.length === 0;
  const failed = state.failed.map((entry) => entry.title).join(', ');
  if (!empty && failed === '') return null;
  return (
    <li role="presentation" className={cn(row, 'flex-col items-start text-fg-muted')}>
      {empty ? <span role="status">{strings.commandPalette.searchEmpty}</span> : null}
      {failed === '' ? null : (
        <span className="text-fg-subtle">{strings.commandPalette.searchFailed(failed)}</span>
      )}
    </li>
  );
}
