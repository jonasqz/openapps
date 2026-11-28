'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { JSX, KeyboardEvent } from 'react';
import { EmptyState } from '../components/EmptyState.tsx';
import { ErrorState } from '../components/ErrorState.tsx';
import { Spinner } from '../components/Spinner.tsx';
import { cn } from '../lib/cn.ts';
import { focusRing } from '../lib/focus.ts';
import { strings } from '../strings.ts';
import type { MentionOption, MentionSearch } from './platform-refs.ts';

/**
 * Personen erwaehnen und Objekte verlinken (ADR 0023 G). Die Treffer kommen
 * von `search`: Personen und Agents mit Lesezugriff auf dieselbe App
 * (`list_people`) und Objekte aus der Suche ueber alle Apps (ADR 0021). Wer
 * keinen Zugriff hat, erscheint gar nicht.
 *
 * Muster „combobox mit listbox“ wie die Befehlspalette: Der Fokus bleibt im
 * Feld, Pfeiltasten bewegen die Auswahl, Enter waehlt, Escape bricht ab.
 * Gewaehlt wird ein Verweis; was daraus im Text wird (`@{ref}`), entscheidet
 * die App.
 */

/** So lange wartet der Picker nach dem letzten Tastendruck. */
export const MENTION_PICKER_DEBOUNCE_MS = 200;

export interface MentionPickerProps {
  search: MentionSearch;
  onSelect: (option: MentionOption) => void;
  /** Escape im Feld. */
  onCancel?: () => void;
  /** Startwert des Suchfelds, etwa der Text nach `@`. */
  initialQuery?: string;
  autoFocus?: boolean;
  className?: string;
}

type PickerState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; options: readonly MentionOption[] }
  | { status: 'error' };

export function MentionPicker({
  search,
  onSelect,
  onCancel,
  initialQuery = '',
  autoFocus = false,
  className,
}: MentionPickerProps): JSX.Element {
  const baseId = useId().replace(/:/g, '');
  const [query, setQuery] = useState(initialQuery);
  const [state, setState] = useState<PickerState>({ status: 'idle' });
  const [active, setActive] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // Entprellt, eine Anfrage zur Zeit; eine aeltere Antwort wird verworfen.
  useEffect(() => {
    const text = query.trim();
    if (text === '') {
      setState({ status: 'idle' });
      return undefined;
    }
    const controller = new AbortController();
    setState({ status: 'loading' });
    const timer = setTimeout(() => {
      search(text, controller.signal).then(
        (options) => {
          if (controller.signal.aborted) return;
          setState({ status: 'done', options });
          setActive(0);
        },
        () => {
          if (!controller.signal.aborted) setState({ status: 'error' });
        },
      );
    }, MENTION_PICKER_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, search, attempt]);

  const options = state.status === 'done' ? state.options : [];
  const optionId = (index: number) => `${baseId}-option-${String(index)}`;

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel?.();
      return;
    }
    if (options.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => (index + 1) % options.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => (index - 1 + options.length) % options.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = options[active];
      if (option !== undefined) onSelect(option);
    }
  }

  const people = options.filter((option) => option.kind !== 'object');
  const objects = options.filter((option) => option.kind === 'object');
  const groups: { label: string; items: readonly MentionOption[] }[] = [
    { label: strings.refs.pickerPeople, items: people },
    { label: strings.refs.pickerObjects, items: objects },
  ].filter((group) => group.items.length > 0);

  return (
    <div data-oa-mention-picker="" className={cn('flex min-w-0 flex-col gap-2', className)}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label={strings.refs.pickerLabel}
        aria-expanded={options.length > 0}
        aria-controls={`${baseId}-list`}
        aria-autocomplete="list"
        {...(options.length > 0 ? { 'aria-activedescendant': optionId(active) } : {})}
        placeholder={strings.refs.pickerPlaceholder}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
        className={cn(
          'min-h-10 w-full rounded-md border border-border-strong bg-bg px-3 text-sm text-fg',
          'placeholder:text-fg-subtle',
          focusRing,
        )}
      />
      {state.status === 'idle' ? (
        <p className="text-xs text-fg-muted">{strings.refs.pickerHint}</p>
      ) : null}
      {state.status === 'loading' ? <Spinner size="sm" label={strings.refs.pickerLoading} /> : null}
      {state.status === 'error' ? (
        <ErrorState
          title={strings.refs.pickerErrorTitle}
          description={strings.refs.pickerErrorDescription}
          action={
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className={cn('text-sm underline underline-offset-2', focusRing)}
            >
              {strings.refs.retry}
            </button>
          }
        />
      ) : null}
      {state.status === 'done' && options.length === 0 ? (
        <EmptyState
          title={strings.refs.pickerEmptyTitle}
          description={strings.refs.pickerEmptyDescription}
        />
      ) : null}
      <ul
        id={`${baseId}-list`}
        role="listbox"
        aria-label={strings.refs.pickerLabel}
        className={cn('flex flex-col', options.length === 0 && 'hidden')}
      >
        {groups.map((group) => (
          <li key={group.label} role="presentation" className="flex flex-col">
            <span
              role="presentation"
              className="px-2 pt-2 font-mono text-2xs uppercase tracking-label text-fg-subtle"
            >
              {group.label}
            </span>
            <ul role="group" aria-label={group.label} className="flex flex-col">
              {group.items.map((option) => {
                const index = options.indexOf(option);
                return (
                  <li
                    key={option.ref}
                    id={optionId(index)}
                    role="option"
                    aria-selected={index === active}
                    data-ref={option.ref}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => onSelect(option)}
                    className={cn(
                      'flex min-w-0 cursor-pointer items-baseline gap-2 rounded-sm px-2 py-1.5 text-sm',
                      index === active ? 'bg-surface-hover text-fg' : 'text-fg-muted',
                    )}
                  >
                    <span className="min-w-0 truncate text-fg">{option.label}</span>
                    {option.kind === 'agent' ? (
                      <span className="shrink-0 text-xs text-fg-subtle">{strings.refs.agentLabel}</span>
                    ) : null}
                    {option.detail === undefined ? null : (
                      <span className="min-w-0 truncate text-xs text-fg-subtle">{option.detail}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
