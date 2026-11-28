import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BacklinksPanel } from './BacklinksPanel.tsx';
import { MentionPicker, MENTION_PICKER_DEBOUNCE_MS } from './MentionPicker.tsx';
import { RefActionsMenu } from './RefActionsMenu.tsx';
import { RefChip, ResolvedRefChip } from './RefChip.tsx';
import { RefText } from './RefText.tsx';
import {
  createBacklinksLoader,
  createMentionSearch,
  createRefResolver,
  parseRefResolution,
  PlatformRefsError,
  type MentionOption,
  type RefResolution,
} from './platform-refs.ts';

/**
 * Die Bausteine der Verweise (ADR 0023 G). Riskant zuerst: Ein Chip ohne
 * Recht darf keinen Titel und keinen App-Namen zeigen, auch wenn die Antwort
 * mehr truege; eine fremde Adresse wird kein Link; jede Liste hat einen
 * leeren und einen Fehlerzustand.
 */

function jsonFetch(body: unknown, status = 200): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('parseRefResolution', () => {
  it('uebernimmt bei restricted nichts ausser Verweis und Zustand', () => {
    expect(
      parseRefResolution({
        ref: 'crm:deal:1',
        state: 'restricted',
        title: 'Secret deal',
        appTitle: 'CRM',
      }),
    ).toEqual({ ref: 'crm:deal:1', state: 'restricted' });
  });

  it('verlinkt keine fremde Adresse', () => {
    expect(
      parseRefResolution({
        ref: 'crm:deal:1',
        state: 'resolved',
        kind: 'object',
        title: 'Deal',
        href: 'javascript:alert(1)',
      }),
    ).toEqual({ ref: 'crm:deal:1', state: 'resolved', kind: 'object', title: 'Deal' });
    expect(parseRefResolution({ ref: 'x', state: 'weird' })).toBeNull();
  });
});

describe('RefChip: alle Zustaende', () => {
  const resolved: RefResolution = {
    ref: 'tasks:task:42',
    state: 'resolved',
    kind: 'object',
    title: 'Write the offer',
    appTitle: 'Tasks',
    href: 'https://apps.example.com/tasks/task/42',
    status: 'Done',
  };

  it('laden', () => {
    const { container } = render(<RefChip state={{ status: 'loading' }} />);
    expect(container.querySelector('[data-oa-ref-chip="loading"]')).not.toBeNull();
    expect(screen.getByText('Loading reference…')).toBeInTheDocument();
  });

  it('aufgeloest: Titel, App, Status und Link', () => {
    render(<RefChip state={{ status: 'done', resolution: resolved }} />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', 'https://apps.example.com/tasks/task/42');
    expect(link).toHaveTextContent('Write the offer');
    expect(link).toHaveTextContent('Tasks');
    expect(link).toHaveTextContent('Done');
  });

  it('restricted ohne Titel, ohne App-Namen und ohne Link', () => {
    const { container } = render(
      <RefChip state={{ status: 'done', resolution: { ref: 'crm:deal:1', state: 'restricted' } }} />,
    );
    expect(screen.getByText('Restricted')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
    expect(container.textContent).not.toContain('crm');
    expect(container.textContent).not.toContain('CRM');
  });

  it('not_found und nicht erreichbar', () => {
    render(
      <>
        <RefChip state={{ status: 'done', resolution: { ref: 'a:b:c', state: 'not_found' } }} />
        <RefChip state={{ status: 'done', resolution: { ref: 'a:b:c', state: 'unavailable' } }} />
      </>,
    );
    expect(screen.getByText('Not found')).toBeInTheDocument();
    expect(screen.getByText('Not available right now')).toBeInTheDocument();
  });

  it('Fehler mit neuem Versuch', async () => {
    const onRetry = vi.fn();
    render(<RefChip state={{ status: 'error' }} onRetry={onRetry} />);
    expect(screen.getByText('Reference not loaded')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('Person mit @ und ohne Link', () => {
    render(
      <RefChip
        state={{
          status: 'done',
          resolution: { ref: 'human:a@b.c', state: 'resolved', kind: 'human', title: 'a@b.c' },
        }}
      />,
    );
    expect(screen.getByText('a@b.c')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('ResolvedRefChip laedt und zeigt nach einem Fehler den neuen Versuch', async () => {
    let fail = true;
    const resolve = vi.fn(async (ref: string): Promise<RefResolution> => {
      if (fail) throw new Error('down');
      return { ref, state: 'resolved', kind: 'object', title: 'Loaded' };
    });
    render(<ResolvedRefChip value="tasks:task:1" resolve={resolve} />);
    await screen.findByText('Reference not loaded');
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('Loaded');
  });
});

describe('createRefResolver', () => {
  it('buendelt die Verweise einer Seite in eine Anfrage und fragt jeden nur einmal', async () => {
    const fetchMock = jsonFetch({
      results: [
        { ref: 'tasks:task:1', state: 'resolved', kind: 'object', title: 'One' },
        { ref: 'crm:deal:2', state: 'restricted' },
      ],
    });
    const resolve = createRefResolver({ fetch: fetchMock, delayMs: 0 });
    const [a, b, again] = await Promise.all([
      resolve('tasks:task:1'),
      resolve('crm:deal:2'),
      resolve('tasks:task:1'),
    ]);
    expect(a).toMatchObject({ title: 'One' });
    expect(b).toEqual({ ref: 'crm:deal:2', state: 'restricted' });
    expect(again).toBe(a);
    expect(fetchMock).toHaveBeenCalledOnce();
    const url = String((fetchMock as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0]);
    expect(url).toBe('/_platform/refs/resolve?ref=tasks%3Atask%3A1&ref=crm%3Adeal%3A2');
  });

  it('wirft bei einem Fehler der Plattform und fragt beim naechsten Mal neu', async () => {
    const fetchMock = jsonFetch({ error: 'no session' }, 401);
    const resolve = createRefResolver({ fetch: fetchMock, delayMs: 0 });
    await expect(resolve('tasks:task:1')).rejects.toBeInstanceOf(PlatformRefsError);
    await expect(resolve('tasks:task:1')).rejects.toBeInstanceOf(PlatformRefsError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('BacklinksPanel: leer, Fehler, Liste', () => {
  it('zeigt den leeren Zustand', async () => {
    render(<BacklinksPanel load={async () => []} />);
    await screen.findByText('No references yet');
  });

  it('zeigt den Fehlerzustand mit neuem Versuch', async () => {
    let calls = 0;
    const load = async () => {
      calls += 1;
      if (calls === 1) throw new Error('down');
      return [];
    };
    render(<BacklinksPanel load={load} />);
    await screen.findByText('References not loaded');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('No references yet');
  });

  it('listet Quellen mit Art und laesst ausgeschlossene Apps weg', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('/_platform/refs/backlinks')) {
        return new Response(
          JSON.stringify({
            backlinks: [
              { source: 'tasks:task:t1', kind: 'derived', appTitle: 'Tasks' },
              { source: 'wiki:page:p2', kind: 'link', appTitle: 'Wiki' },
            ],
          }),
        );
      }
      return new Response(
        JSON.stringify({
          results: [
            { ref: 'tasks:task:t1', state: 'resolved', kind: 'object', title: 'Follow up', href: '/tasks/task/t1' },
            { ref: 'wiki:page:p2', state: 'resolved', kind: 'object', title: 'Other page' },
          ],
        }),
      );
    }) as unknown as typeof fetch;
    const load = createBacklinksLoader('wiki:page:p1', {
      fetch: fetchMock,
      resolve: createRefResolver({ fetch: fetchMock, delayMs: 0 }),
    });
    render(<BacklinksPanel load={load} excludeApps={['wiki']} />);
    await screen.findByText('Follow up');
    expect(screen.getByText('Created from this')).toBeInTheDocument();
    expect(screen.queryByText('Other page')).toBeNull();
  });
});

describe('MentionPicker: leer, Fehler, Auswahl', () => {
  const people: MentionOption[] = [
    { ref: 'human:anna@example.com', kind: 'human', label: 'Anna', detail: 'anna@example.com' },
    { ref: 'agent:helper', kind: 'agent', label: 'Helper' },
    { ref: 'tasks:task:42', kind: 'object', label: 'Write the offer', detail: 'Tasks · task' },
  ];

  async function typeInto(text: string): Promise<void> {
    await userEvent.type(screen.getByRole('combobox'), text);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, MENTION_PICKER_DEBOUNCE_MS + 20));
    });
  }

  it('zeigt Personen und Objekte und waehlt mit Pfeil und Enter', async () => {
    const onSelect = vi.fn();
    render(<MentionPicker search={async () => people} onSelect={onSelect} />);
    expect(screen.getByText('Type to find people and items.')).toBeInTheDocument();
    await typeInto('an');
    await screen.findByText('Anna');
    expect(screen.getByRole('group', { name: 'People' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Items' })).toBeInTheDocument();
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(onSelect).toHaveBeenCalledWith(people[1]);
  });

  it('zeigt den leeren Zustand', async () => {
    render(<MentionPicker search={async () => []} onSelect={() => undefined} />);
    await typeInto('zz');
    await screen.findByText('No matches');
  });

  it('zeigt den Fehlerzustand und versucht es neu', async () => {
    let fail = true;
    render(
      <MentionPicker
        search={async () => {
          if (fail) throw new Error('down');
          return people;
        }}
        onSelect={() => undefined}
      />,
    );
    await typeInto('an');
    await screen.findByText('Search is not available');
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, MENTION_PICKER_DEBOUNCE_MS + 20));
    });
    await waitFor(() => expect(screen.getByText('Anna')).toBeInTheDocument());
  });
});

describe('createMentionSearch', () => {
  it('nimmt Personen und nur Treffer mit Verweis; eine Quelle darf ausfallen', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ people: [{ ref: 'human:anna@example.com', kind: 'human', label: 'Anna', detail: 'anna@example.com' }] }),
      ),
    ) as unknown as typeof fetch;
    const search = createMentionSearch('wiki', {
      fetch: fetchMock,
      search: async () => ({
        results: [
          {
            app: 'tasks',
            title: 'Tasks',
            hits: [
              { id: '42', title: 'Write the offer', href: '/tasks/task/42', kind: 'task', ref: 'tasks:task:42' },
              { id: 'c', title: 'No ref', href: '/tasks/x' },
            ],
          },
        ],
        failed: [],
      }),
    });
    const options = await search('an', new AbortController().signal);
    expect(options.map((o) => o.ref)).toEqual(['human:anna@example.com', 'tasks:task:42']);

    const peopleOnly = createMentionSearch('wiki', {
      fetch: fetchMock,
      search: async () => {
        throw new Error('search down');
      },
    });
    expect((await peopleOnly('an', new AbortController().signal)).map((o) => o.ref)).toEqual([
      'human:anna@example.com',
    ]);
  });
});

describe('RefActionsMenu', () => {
  it('laedt beim Oeffnen mit Auszug und zeigt Links, leer und Fehler', async () => {
    const load = vi.fn(async (excerpt?: string) =>
      excerpt === 'empty'
        ? []
        : [{ app: 'tasks', appTitle: 'Tasks', name: 'task_from_ref', title: 'Create task', href: '/tasks/new?ref=wiki%3Apage%3Ap1' }],
    );
    const { unmount } = render(<RefActionsMenu load={load} excerpt={() => 'Section'} />);
    await userEvent.click(screen.getByRole('button', { name: 'Create from this' }));
    const link = await screen.findByRole('link', { name: /Create task/ });
    expect(link).toHaveAttribute('href', '/tasks/new?ref=wiki%3Apage%3Ap1');
    expect(load).toHaveBeenCalledWith('Section');
    unmount();

    render(<RefActionsMenu load={load} excerpt={() => 'empty'} />);
    await userEvent.click(screen.getByRole('button', { name: 'Create from this' }));
    await screen.findByText('Nothing to create from here');
  });

  it('zeigt den Fehlerzustand', async () => {
    render(
      <RefActionsMenu
        load={async () => {
          throw new Error('down');
        }}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Create from this' }));
    await screen.findByText('Actions not loaded');
  });
});

describe('RefText', () => {
  it('zeigt Text als Text und Verweise als Chips', async () => {
    const resolve = async (ref: string): Promise<RefResolution> =>
      ref === 'tasks:task:1'
        ? { ref, state: 'resolved', kind: 'object', title: 'One' }
        : { ref, state: 'restricted' };
    const { container } = render(
      <RefText
        segments={[{ text: 'See ' }, { ref: 'tasks:task:1' }, { text: ' and ' }, { ref: 'crm:deal:9' }, { text: '<b>x</b>' }]}
        resolve={resolve}
      />,
    );
    await screen.findByText('One');
    await screen.findByText('Restricted');
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<b>x</b>');
  });
});
