'use client';

/**
 * Home: der eigene Eingang mit Tastatur-Triage (ADR 0022 D). Die Seite ruft
 * nur `GET /api/inbox` und `POST /api/inbox/mark`, dieselben Endpunkte, die
 * es als MCP-Tools `list_inbox` und `mark_inbox` gibt. Hier steht keine
 * Rechtepruefung: Was die Liste zeigt, hat die Control Plane schon gefiltert.
 */

import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Kbd,
  Select,
  Spinner,
  Tabs,
  cn,
  focusRing,
  useToast,
} from '@openapps/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import {
  applyMark,
  commandForKey,
  moveIndex,
  type TriageCommand,
  type TriageState,
  type TriageView,
} from './triage';

export interface HomeItem {
  readonly id: string;
  readonly state: TriageState;
  readonly app: string;
  readonly appTitle: string;
  readonly type: string;
  readonly title: string;
  readonly href: string | null;
  readonly actorLabel: string | null;
  readonly importance: 'high' | 'normal' | 'low';
  readonly via: 'direct' | 'group';
  readonly viaGroup: string | null;
  readonly occurredAt: string;
}

export interface HomeData {
  readonly items: readonly HomeItem[];
  readonly unread: number;
  readonly apps: readonly { readonly name: string; readonly title: string }[];
}

export interface InboxTriageProps {
  /** Erster Stand vom Server, oder `null`, wenn er nicht geladen werden konnte. */
  readonly initial: HomeData | null;
  /** Fehlertext vom Server, wenn `initial` fehlt. */
  readonly initialError?: string;
}

const ALL_APPS = '';

const messageOf = (payload: unknown, fallback: string): string =>
  typeof payload === 'object' && payload !== null && 'message' in payload
    ? String((payload as { message?: unknown }).message)
    : fallback;

function isHomeData(value: unknown): value is HomeData {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { items?: unknown }).items) &&
    Array.isArray((value as { apps?: unknown }).apps)
  );
}

function timeLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function InboxTriage({ initial, initialError }: InboxTriageProps): JSX.Element {
  const toast = useToast();
  const [view, setView] = useState<TriageView>('open');
  const [app, setApp] = useState<string>(ALL_APPS);
  const [data, setData] = useState<HomeData | null>(initial);
  const [error, setError] = useState<string | undefined>(
    initial === null ? (initialError ?? 'The inbox could not be loaded.') : undefined,
  );
  const [loading, setLoading] = useState(false);
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const first = useRef(true);

  const items = useMemo(() => data?.items ?? [], [data]);
  const current = items[Math.min(index, Math.max(items.length - 1, 0))];

  const load = useCallback(async (nextView: TriageView, nextApp: string): Promise<void> => {
    setLoading(true);
    setError(undefined);
    try {
      const params = new URLSearchParams({ state: nextView });
      if (nextApp !== ALL_APPS) params.set('app', nextApp);
      const response = await fetch(`/api/inbox?${params.toString()}`, {
        headers: { accept: 'application/json' },
        cache: 'no-store',
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || !isHomeData(payload)) {
        setError(messageOf(payload, 'The inbox could not be loaded.'));
        return;
      }
      setData(payload);
      setIndex(0);
    } catch {
      setError('The inbox could not be loaded. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Der erste Stand kommt vom Server; neu geladen wird nur bei einem Filter.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void load(view, app);
  }, [view, app, load]);

  const mark = useCallback(
    async (ids: readonly string[], state: TriageState): Promise<boolean> => {
      if (data === null || ids.length === 0) return false;
      const before = data;
      const unreadDelta = before.items.reduce((delta, item) => {
        if (!ids.includes(item.id)) return delta;
        return delta + (state === 'unread' ? 1 : 0) - (item.state === 'unread' ? 1 : 0);
      }, 0);
      setData({
        ...before,
        items: applyMark(before.items, ids, state, view),
        unread: Math.max(0, before.unread + unreadDelta),
      });
      try {
        const response = await fetch('/api/inbox/mark', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ids, state }),
        });
        if (!response.ok) throw new Error(messageOf(await response.json().catch(() => null), ''));
        return true;
      } catch (cause) {
        setData(before);
        toast.show({
          title: 'Could not update the inbox',
          description:
            cause instanceof Error && cause.message !== '' ? cause.message : 'Try again.',
          tone: 'danger',
        });
        return false;
      }
    },
    [data, view, toast],
  );

  const run = useCallback(
    (command: TriageCommand, target: HomeItem | undefined): void => {
      if (command === 'next' || command === 'previous') {
        setIndex((value) => moveIndex(value, items.length, command));
        return;
      }
      if (target === undefined) return;
      if (command === 'open') {
        if (target.href === null) return;
        const href = target.href;
        if (target.state === 'unread') {
          void mark([target.id], 'read').finally(() => window.location.assign(href));
        } else {
          window.location.assign(href);
        }
        return;
      }
      void mark([target.id], command);
    },
    [items.length, mark],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const command = commandForKey({
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        targetTag: target?.tagName ?? null,
        targetEditable: target?.isContentEditable === true,
      });
      // Ein offener Dialog (Befehlspalette) hat Vorrang.
      if (command === null || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      event.preventDefault();
      run(command, current);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [run, current]);

  // Der gewaehlte Eintrag bleibt sichtbar.
  useEffect(() => {
    if (current === undefined) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-id="${current.id}"]`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [current]);

  const appOptions = [
    { value: ALL_APPS, label: 'All apps' },
    ...(data?.apps ?? []).map((entry) => ({ value: entry.name, label: entry.title })),
  ];

  const list = (
    <div className="mt-4">
      {error !== undefined ? (
        <ErrorState
          title="The inbox could not be loaded"
          description={error}
          action={
            <Button variant="secondary" size="sm" onClick={() => void load(view, app)}>
              Try again
            </Button>
          }
        />
      ) : loading && items.length === 0 ? (
        <div className="flex items-center gap-2 py-8 text-sm text-fg-muted">
          <Spinner />
          <span>Loading</span>
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title={view === 'open' ? 'Nothing new' : 'Nothing done yet'}
          description={
            view === 'open'
              ? 'When something happens for you in an app you may open, it shows up here.'
              : 'Items you mark as done appear here for as long as the platform keeps them.'
          }
        />
      ) : (
        <ul
          ref={listRef}
          aria-label="Inbox"
          className="divide-y divide-border border-y border-border"
        >
          {items.map((item, position) => {
            const selected = item.id === current?.id;
            return (
              <li
                key={item.id}
                data-id={item.id}
                data-state={item.state}
                aria-current={selected ? 'true' : undefined}
                onClick={() => setIndex(position)}
                className={cn(
                  'flex min-w-0 items-start gap-3 px-3 py-3 transition-colors duration-150',
                  selected ? 'bg-surface-hover' : 'hover:bg-surface',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                    item.state === 'unread' ? 'bg-primary' : 'bg-transparent',
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-fg-muted">
                    <span className="font-medium text-fg">{item.appTitle}</span>
                    {item.importance === 'high' ? (
                      <Badge tone="primary">High</Badge>
                    ) : item.importance === 'low' ? (
                      <Badge>Low</Badge>
                    ) : null}
                    {item.via === 'group' && item.viaGroup !== null ? (
                      <span>via {item.viaGroup}</span>
                    ) : null}
                    {item.actorLabel === null ? null : <span>by {item.actorLabel}</span>}
                    <time dateTime={item.occurredAt}>{timeLabel(item.occurredAt)}</time>
                    {item.state === 'unread' ? <span className="sr-only">Unread</span> : null}
                  </div>
                  {item.href === null ? (
                    <p
                      className={cn(
                        'mt-0.5 truncate text-sm',
                        item.state === 'unread' && 'font-medium',
                      )}
                    >
                      {item.title}
                    </p>
                  ) : (
                    <a
                      href={item.href}
                      onClick={(event) => {
                        if (event.button !== 0 || event.metaKey || event.ctrlKey) return;
                        event.preventDefault();
                        run('open', item);
                      }}
                      className={cn(
                        'mt-0.5 block truncate rounded-sm text-sm text-fg hover:underline',
                        item.state === 'unread' && 'font-medium',
                        focusRing,
                      )}
                    >
                      {item.title}
                    </a>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {view === 'open' ? (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          void mark([item.id], item.state === 'unread' ? 'read' : 'unread')
                        }
                      >
                        {item.state === 'unread' ? 'Mark read' : 'Mark unread'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void mark([item.id], 'done')}
                      >
                        Done
                      </Button>
                    </>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => void mark([item.id], 'read')}>
                      Reopen
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <p className="text-sm text-fg-muted" aria-live="polite">
          {data === null ? '' : `${String(data.unread)} unread`}
        </p>
        <div className="w-56">
          <Select
            label="App"
            options={appOptions}
            value={app}
            onChange={(event) => setApp(event.target.value)}
          />
        </div>
      </div>
      <Tabs
        className="mt-4"
        label="Inbox view"
        tabId={view}
        onTabChange={(id) => setView(id === 'done' ? 'done' : 'open')}
        items={[
          { id: 'open', label: 'Open', content: view === 'open' ? list : null },
          { id: 'done', label: 'Done', content: view === 'done' ? list : null },
        ]}
      />
      <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
        <span>
          <Kbd>j</Kbd> <Kbd>k</Kbd> move
        </span>
        <span>
          <Kbd>Enter</Kbd> open
        </span>
        <span>
          <Kbd>r</Kbd> read
        </span>
        <span>
          <Kbd>u</Kbd> unread
        </span>
        <span>
          <Kbd>e</Kbd> done
        </span>
      </p>
    </div>
  );
}
