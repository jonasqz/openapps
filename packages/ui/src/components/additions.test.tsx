import { act, fireEvent, render, screen } from '@testing-library/react';
import type { JSX } from 'react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AppShell } from '../shell/AppShell.tsx';
import { filterCommands } from '../shell/CommandPalette.tsx';
import { PageHeader } from './PageHeader.tsx';
import { Stat } from './Stat.tsx';
import { Table } from './Table.tsx';
import { ToastProvider, useToast } from './Toast.tsx';

const user = { id: 'u1', email: 'anna@example.com', name: 'Anna Example' };

describe('Befehlspalette', () => {
  const items = [
    { id: 'a', label: 'Apps', href: '/' },
    { id: 'g', label: 'Grants', href: '/grants', hint: '/grants' },
    { id: 'x', label: 'Get started', href: '/get-started' },
  ];

  it('sortiert Treffer am Wortanfang nach vorn und durchsucht auch den Zusatz', () => {
    expect(filterCommands(items, 'g').map((i) => i.id)).toEqual(['g', 'x']);
    expect(filterCommands(items, 'started').map((i) => i.id)).toEqual(['x']);
    expect(filterCommands(items, '').length).toBe(3);
  });

  it('öffnet mit Strg+K und navigiert mit Pfeil und Enter über onNavigate', async () => {
    const onNavigate = vi.fn();
    render(
      <AppShell
        appName="Admin"
        user={user}
        onNavigate={onNavigate}
        nav={[{ items: [
          { id: 'apps', label: 'Apps', href: '/', current: true },
          { id: 'grants', label: 'Grants', href: '/grants' },
        ] }]}
      >
        <p>Content</p>
      </AppShell>,
    );
    await userEvent.keyboard('{Control>}k{/Control}');
    const input = screen.getByRole('combobox');
    expect(input).toHaveFocus();
    await userEvent.type(input, 'gra');
    await userEvent.keyboard('{Enter}');
    expect(onNavigate).toHaveBeenCalledWith('/grants');
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('schließt mit Escape', async () => {
    render(
      <AppShell appName="Admin" user={user} nav={[{ items: [{ id: 'a', label: 'Apps', href: '/' }] }]}>
        <p>Content</p>
      </AppShell>,
    );
    await userEvent.keyboard('{Control>}k{/Control}');
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('lässt sich abschalten', async () => {
    render(
      <AppShell appName="Admin" user={user} commandPalette={false} nav={[{ items: [{ id: 'a', label: 'Apps', href: '/' }] }]}>
        <p>Content</p>
      </AppShell>,
    );
    await userEvent.keyboard('{Control>}k{/Control}');
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});

describe('Tabellensuche', () => {
  const rows = [
    { id: '1', subject: 'group:sales', resource: 'app:crm' },
    { id: '2', subject: 'agent:writer', resource: 'tool:crm.companies.list' },
    { id: '3', subject: 'group:everyone', resource: 'app:wiki' },
  ];
  const columns = [
    { field: 'subject' as const, header: 'Subject' },
    { field: 'resource' as const, header: 'Resource' },
  ];

  it('filtert über alle Feldspalten und nennt die Trefferzahl', async () => {
    render(<Table caption="Grants" columns={columns} rows={rows} searchable />);
    expect(screen.getByText('3')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Search Grants'), 'crm');
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(screen.getByText('2 of 3')).toBeInTheDocument();
  });

  it('zeigt einen eigenen Zustand ohne Treffer und setzt ihn zurück', async () => {
    render(<Table caption="Grants" columns={columns} rows={rows} searchable />);
    await userEvent.type(screen.getByLabelText('Search Grants'), 'nothing-here');
    expect(screen.getByText('No matches')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filter' }));
    expect(screen.getAllByRole('row')).toHaveLength(4);
  });

  it('gibt abgeschnittenen Zellen den vollen Wert als title', () => {
    render(<Table caption="Grants" columns={columns} rows={rows} />);
    expect(screen.getByText('tool:crm.companies.list')).toHaveAttribute('title', 'tool:crm.companies.list');
  });
});

describe('PageHeader und Stat', () => {
  it('trägt die einzige h1 und einen Pfad mit aktueller Seite', () => {
    render(
      <PageHeader
        title="Grants"
        breadcrumbs={[{ label: 'Platform', href: '/' }, { label: 'Grants' }]}
        actions={<button type="button">Grant</button>}
      />,
    );
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Platform' })).toHaveAttribute('href', '/');
    expect(screen.getByText('Grants', { selector: '[aria-current="page"]' })).toBeInTheDocument();
  });

  it('wird mit href zum Link', () => {
    render(<Stat label="Apps live" value="4" href="/apps" />);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/apps');
  });
});

describe('Toast mit Aktion', () => {
  function UndoHarness({ onUndo }: { onUndo: () => void }): JSX.Element {
    const toast = useToast();
    return (
      <button
        type="button"
        onClick={() => toast.show({ title: 'Grant revoked', action: { label: 'Undo', onClick: onUndo } })}
      >
        Revoke
      </button>
    );
  }

  it('ruft die Aktion und schließt die Meldung', async () => {
    const onUndo = vi.fn();
    render(
      <ToastProvider>
        <UndoHarness onUndo={onUndo} />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Grant revoked')).toBeNull();
  });

  it('bleibt mit Aktion 10 s stehen und pausiert, solange die Maus darauf liegt', () => {
    vi.useFakeTimers();
    try {
      render(
        <ToastProvider>
          <UndoHarness onUndo={() => undefined} />
        </ToastProvider>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
      act(() => vi.advanceTimersByTime(7000));
      expect(screen.getByText('Grant revoked')).toBeInTheDocument();

      fireEvent.mouseEnter(screen.getByRole('status'));
      act(() => vi.advanceTimersByTime(20000));
      expect(screen.getByText('Grant revoked')).toBeInTheDocument();

      fireEvent.mouseLeave(screen.getByRole('status'));
      act(() => vi.advanceTimersByTime(10001));
      expect(screen.queryByText('Grant revoked')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
