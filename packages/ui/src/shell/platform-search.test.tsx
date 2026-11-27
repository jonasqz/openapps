import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CommandPalette, type CommandItem } from './CommandPalette.tsx';
import {
  createPlatformSearch,
  parsePlatformSearchResponse,
  PLATFORM_SEARCH_DEBOUNCE_MS,
  PlatformSearchError,
  type PlatformSearch,
  type PlatformSearchResponse,
} from './platform-search.ts';

/**
 * Die Suche ueber alle Apps in der Befehlspalette (ADR 0021). Riskant ist,
 * dass ein Treffer zu einer fremden Adresse fuehrt, und dass eine kaputte
 * oder langsame Suche die Palette mitnimmt. Deshalb zuerst das.
 */

const RESPONSE: PlatformSearchResponse = {
  results: [
    {
      app: 'crm',
      title: 'CRM',
      hits: [
        {
          id: 'd1',
          title: 'Deal Angebot Nord',
          snippet: 'ACME «Angebot» · Proposal',
          kind: 'deal',
          href: 'https://apps.example.test/crm/deals/d1',
        },
      ],
    },
    {
      app: 'tasks',
      title: 'Tasks',
      hits: [{ id: 't1', title: 'Angebot schreiben', href: 'https://apps.example.test/tasks/task/t1' }],
    },
  ],
  failed: [],
};

const ITEMS: CommandItem[] = [
  { id: 'section:pipeline', label: 'Pipeline', href: '/', group: 'CRM' },
  { id: 'app:wiki', label: 'Wiki', href: 'https://apps.example.test/wiki', group: 'Apps' },
];

function renderPalette(search?: PlatformSearch, onSelect = vi.fn()) {
  render(
    <CommandPalette
      open
      onClose={() => undefined}
      items={ITEMS}
      onSelect={onSelect}
      {...(search === undefined ? {} : { search })}
    />,
  );
  return { onSelect, input: screen.getByRole('combobox') };
}

beforeAll(() => {
  // jsdom kennt kein Scrollen; die Palette haelt den aktiven Eintrag sichtbar.
  Element.prototype.scrollIntoView = () => undefined;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('parsePlatformSearchResponse', () => {
  it('laesst Treffer mit fremdem Schema oder ohne Titel weg', () => {
    const parsed = parsePlatformSearchResponse({
      results: [
        {
          app: 'crm',
          title: 'CRM',
          hits: [
            { id: '1', title: 'Gut', href: 'https://apps.example.test/crm/deals/1' },
            { id: '2', title: 'Script', href: 'javascript:alert(1)' },
            { id: '3', title: 'Protokollrelativ', href: '//evil.example/x' },
            { id: '4', title: '', href: '/crm/x' },
          ],
        },
        { app: 'leer', title: 'Leer', hits: [{ id: '5', title: 'x', href: 'data:text/html,x' }] },
      ],
      failed: [{ app: 'wiki', title: 'Wiki', reason: 'timeout' }, 'kaputt'],
    });
    expect(parsed?.results).toEqual([
      { app: 'crm', title: 'CRM', hits: [{ id: '1', title: 'Gut', href: 'https://apps.example.test/crm/deals/1' }] },
    ]);
    expect(parsed?.failed).toEqual([{ app: 'wiki', title: 'Wiki', reason: 'timeout' }]);
  });

  it('ist null ohne die Form der Antwort', () => {
    expect(parsePlatformSearchResponse(null)).toBeNull();
    expect(parsePlatformSearchResponse({ hits: [] })).toBeNull();
  });
});

describe('createPlatformSearch', () => {
  it('fragt den reservierten Pfad auf dem eigenen Origin mit dem eigenen Cookie', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(RESPONSE), { status: 200 }));
    const search = createPlatformSearch({ fetch: fetchMock as unknown as typeof fetch });
    const result = await search('Angebot & Co', new AbortController().signal);
    expect(result.results).toHaveLength(2);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/_platform/search?q=Angebot%20%26%20Co');
    expect(init.credentials).toBe('same-origin');
  });

  it('wirft bei einer Antwort ausser 2xx und bei unbrauchbarem Inhalt', async () => {
    const status = createPlatformSearch({
      fetch: (async () => new Response('sign in first', { status: 401 })) as unknown as typeof fetch,
    });
    await expect(status('ab', new AbortController().signal)).rejects.toBeInstanceOf(PlatformSearchError);
    const html = createPlatformSearch({
      fetch: (async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch,
    });
    await expect(html('ab', new AbortController().signal)).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('Befehlspalette mit Suche ueber alle Apps', () => {
  it('fragt erst ab zwei Zeichen und entprellt', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const search = vi.fn<PlatformSearch>(async () => RESPONSE);
    const { input } = renderPalette(search);
    const typing = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    await typing.type(input, 'a');
    await act(async () => {
      vi.advanceTimersByTime(PLATFORM_SEARCH_DEBOUNCE_MS * 2);
    });
    expect(search).not.toHaveBeenCalled();
    expect(screen.queryByText('Searching your apps…')).toBeNull();

    await typing.type(input, 'ngebot');
    await act(async () => {
      vi.advanceTimersByTime(PLATFORM_SEARCH_DEBOUNCE_MS + 10);
    });
    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0]?.[0]).toBe('angebot');
  });

  it('zeigt einen Ladezustand und danach die Treffer nach App gruppiert, ohne Treffermarken', async () => {
    let resolve: (value: PlatformSearchResponse) => void = () => undefined;
    const search = vi.fn<PlatformSearch>(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const { input } = renderPalette(search);
    await userEvent.type(input, 'angebot');
    expect(await screen.findByText('Searching your apps…')).toBeInTheDocument();
    await waitFor(() => expect(search).toHaveBeenCalled());
    await act(async () => {
      resolve(RESPONSE);
    });
    expect(await screen.findByText('Deal Angebot Nord')).toBeInTheDocument();
    expect(screen.getByText('ACME Angebot · Proposal')).toBeInTheDocument();
    expect(screen.getByText('Tasks')).toBeInTheDocument();
    expect(screen.queryByText('Searching your apps…')).toBeNull();
    // Kein Sprungziel passt, also stehen nur Treffer in der Liste.
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Deal Angebot NordACME Angebot · Proposaldeal',
      'Angebot schreiben',
    ]);
  });

  it('erreicht die Treffer mit den Pfeiltasten wie jeden anderen Eintrag', async () => {
    const search = vi.fn<PlatformSearch>(async () => RESPONSE);
    const { input, onSelect } = renderPalette(search);
    await userEvent.type(input, 'pi');
    // „Pipeline“ passt als Sprungziel und steht zuerst.
    await screen.findByText('Deal Angebot Nord');
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'search:tasks:t1', href: 'https://apps.example.test/tasks/task/t1' }),
    );
  });

  it('zeigt einen Leerzustand, wenn keine App etwas findet', async () => {
    renderPalette(async () => ({ results: [], failed: [] }));
    await userEvent.type(screen.getByRole('combobox'), 'zzz');
    expect(await screen.findByText('No results in your apps')).toBeInTheDocument();
    // Die Leermeldung der Sprungziele steht nicht doppelt da.
    expect(screen.queryByText('No matches')).toBeNull();
  });

  it('zeigt einen Fehlerzustand, und die Sprungziele bleiben benutzbar', async () => {
    const { input, onSelect } = renderPalette(async () => {
      throw new PlatformSearchError('http', 502);
    });
    await userEvent.type(input, 'pipe');
    expect(await screen.findByRole('alert')).toHaveTextContent('Search is not available right now');
    await userEvent.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'section:pipeline' }));
  });

  it('nennt Apps, die nicht geantwortet haben, und zeigt die anderen Treffer', async () => {
    renderPalette(async () => ({
      results: RESPONSE.results.slice(0, 1),
      failed: [{ app: 'wiki', title: 'Wiki', reason: 'timeout' }],
    }));
    await userEvent.type(screen.getByRole('combobox'), 'angebot');
    expect(await screen.findByText('No answer from Wiki')).toBeInTheDocument();
    expect(screen.getByText('Deal Angebot Nord')).toBeInTheDocument();
  });

  it('verwirft eine aeltere Antwort, die nach einer neueren kommt', async () => {
    const pending: Array<(value: PlatformSearchResponse) => void> = [];
    const search = vi.fn<PlatformSearch>(
      () =>
        new Promise((done) => {
          pending.push(done);
        }),
    );
    const { input } = renderPalette(search);
    await userEvent.type(input, 'an');
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    await userEvent.type(input, 'gebot');
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2));
    await act(async () => {
      pending[1]?.({ results: RESPONSE.results.slice(1), failed: [] });
    });
    await act(async () => {
      pending[0]?.(RESPONSE);
    });
    expect(screen.getByText('Angebot schreiben')).toBeInTheDocument();
    expect(screen.queryByText('Deal Angebot Nord')).toBeNull();
  });

  it('sucht ohne Suche gar nicht und behaelt die alte Leermeldung', async () => {
    renderPalette();
    await userEvent.type(screen.getByRole('combobox'), 'zzz');
    expect(screen.getByText('No matches')).toBeInTheDocument();
    expect(screen.queryByText('Searching your apps…')).toBeNull();
  });
});
