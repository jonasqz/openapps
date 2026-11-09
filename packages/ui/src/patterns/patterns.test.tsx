import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DetailPattern } from './DetailPattern.tsx';
import { FormPattern } from './FormPattern.tsx';
import { ListPattern } from './ListPattern.tsx';

interface Row {
  id: string;
  name: string;
  status: string;
}

const columns = [
  { key: 'name', header: 'Name', cell: (row: Row) => row.name },
  { key: 'status', header: 'Status', cell: (row: Row) => row.status, hideBelow: 'sm' as const },
];

const rows: readonly Row[] = [
  { id: '1', name: 'Anna Beispiel', status: 'offen' },
  { id: '2', name: 'Bert Beispiel', status: 'erledigt' },
];

describe('ListPattern', () => {
  it('filtert über Suche und Auswahl', async () => {
    function Harness(): JSX.Element {
      const [search, setSearch] = useState('');
      const [status, setStatus] = useState('');
      const visible = rows.filter(
        (row) =>
          row.name.toLowerCase().includes(search.toLowerCase()) &&
          (status === '' || row.status === status),
      );
      return (
        <ListPattern
          title="Anträge"
          columns={columns}
          rows={visible}
          rowKey={(row) => row.id}
          search={{ label: 'Suche', value: search, onChange: setSearch }}
          filters={[
            {
              id: 'status',
              label: 'Status',
              value: status,
              onChange: setStatus,
              options: [
                { value: '', label: 'Alle' },
                { value: 'offen', label: 'Offen' },
                { value: 'erledigt', label: 'Erledigt' },
              ],
            },
          ]}
          filtersActive={search !== '' || status !== ''}
          onResetFilters={() => {
            setSearch('');
            setStatus('');
          }}
          empty={{ title: 'Noch keine Anträge' }}
          emptyFiltered={{ title: 'Kein Treffer', description: 'Die Filter sind zu eng.' }}
        />
      );
    }
    render(<Harness />);
    expect(screen.getByText('Anna Beispiel')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Suche'), 'Bert');
    expect(screen.queryByText('Anna Beispiel')).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Suche'), 'xyz');
    expect(screen.getByText('Kein Treffer')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }));
    expect(screen.getByText('Anna Beispiel')).toBeInTheDocument();
  });

  it('zeigt leeren Zustand und gefilterten leeren Zustand unterschiedlich', () => {
    const { rerender } = render(
      <ListPattern
        title="Anträge"
        columns={columns}
        rows={[]}
        rowKey={(row) => row.id}
        empty={{ title: 'Noch keine Anträge' }}
        emptyFiltered={{ title: 'Kein Treffer' }}
      />,
    );
    expect(screen.getByText('Noch keine Anträge')).toBeInTheDocument();
    rerender(
      <ListPattern
        title="Anträge"
        columns={columns}
        rows={[]}
        rowKey={(row) => row.id}
        filtersActive
        empty={{ title: 'Noch keine Anträge' }}
        emptyFiltered={{ title: 'Kein Treffer' }}
      />,
    );
    expect(screen.getByText('Kein Treffer')).toBeInTheDocument();
  });

  it('zeigt den Fehlerzustand und lässt erneut laden', async () => {
    const retry = vi.fn();
    render(
      <ListPattern
        title="Anträge"
        columns={columns}
        rows={[]}
        rowKey={(row) => row.id}
        error={{ title: 'Nicht geladen', description: 'Gateway antwortet nicht.', retry }}
        empty={{ title: 'leer' }}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Nicht geladen');
    await userEvent.click(screen.getByRole('button', { name: 'Erneut laden' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('blättert bei vielen Einträgen', async () => {
    const onPageChange = vi.fn();
    render(
      <ListPattern
        title="Anträge"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        page={1}
        pageSize={2}
        total={120}
        onPageChange={onPageChange}
        empty={{ title: 'leer' }}
      />,
    );
    expect(screen.getByText('1–2 von 120 · Seite 1 von 60')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Weiter' }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });
});

describe('FormPattern', () => {
  const fields = [
    { kind: 'text' as const, name: 'titel', label: 'Titel', required: true },
    { kind: 'email' as const, name: 'mail', label: 'E-Mail', required: true },
    {
      kind: 'select' as const,
      name: 'art',
      label: 'Art',
      options: [{ value: 'urlaub', label: 'Urlaub' }],
      placeholder: 'Bitte wählen',
    },
    { kind: 'checkbox' as const, name: 'ok', label: 'Richtlinie gelesen', required: true },
  ];

  it('zeigt Validierungsfehler sichtbar am Feld und in der Zusammenfassung', async () => {
    const onSubmit = vi.fn();
    render(<FormPattern title="Antrag" fields={fields} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(onSubmit).not.toHaveBeenCalled();

    const titel = screen.getByLabelText(/Titel/);
    expect(titel).toHaveAttribute('aria-invalid', 'true');
    const describedBy = titel.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(describedBy)).toHaveTextContent('Bitte ausfüllen.');
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(1);
    expect(screen.getByText('3 Felder prüfen')).toBeInTheDocument();
    // Sprungmarke aus der Zusammenfassung zum Feld
    expect(screen.getByRole('link', { name: 'Titel' })).toHaveAttribute('href', `#${titel.id}`);
  });

  it('prüft E-Mail-Format beim Verlassen des Feldes', async () => {
    render(<FormPattern title="Antrag" fields={fields} onSubmit={() => {}} />);
    await userEvent.type(screen.getByLabelText(/E-Mail/), 'keine-mail');
    await userEvent.tab();
    expect(screen.getByText('Bitte eine gültige E-Mail-Adresse angeben.')).toBeInTheDocument();
  });

  it('übernimmt Feldfehler vom Server', async () => {
    render(
      <FormPattern
        title="Antrag"
        fields={[{ kind: 'text', name: 'titel', label: 'Titel' }]}
        onSubmit={() => ({ titel: 'Titel ist schon vergeben.' })}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(screen.getByText('Titel ist schon vergeben.')).toBeInTheDocument();
  });

  it('sendet gültige Werte', async () => {
    const onSubmit = vi.fn();
    render(
      <FormPattern
        title="Antrag"
        fields={[{ kind: 'text', name: 'titel', label: 'Titel', required: true }]}
        onSubmit={onSubmit}
      />,
    );
    await userEvent.type(screen.getByLabelText(/Titel/), 'Sommerurlaub');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(onSubmit).toHaveBeenCalledWith({ titel: 'Sommerurlaub' });
  });
});

describe('DetailPattern', () => {
  const sections = [
    {
      title: 'Antrag',
      fields: [
        { label: 'Zeitraum', value: '01.07. – 14.07.2026' },
        { label: 'Begründung', value: 'Sehr'.repeat(80), wide: true },
      ],
    },
  ];

  it('zeigt Abschnitte als Label-Wert-Paare', () => {
    render(<DetailPattern title="Sommerurlaub" eyebrow="URL-2026-014" sections={sections} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Sommerurlaub' })).toBeInTheDocument();
    expect(screen.getByText('Zeitraum')).toBeInTheDocument();
  });

  it('zeigt den Ladezustand statt leerer Abschnitte', () => {
    render(<DetailPattern title="Lädt" sections={sections} loading />);
    expect(screen.getByText('Einzelheiten werden geladen …')).toBeInTheDocument();
    expect(screen.queryByText('Zeitraum')).not.toBeInTheDocument();
  });

  it('zeigt den Fehlerzustand statt der Ansicht', () => {
    render(<DetailPattern title="X" sections={sections} error={{ title: 'Nicht gefunden' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Nicht gefunden');
  });

  it('bietet den Zurück-Weg als erstes Element an', async () => {
    const back = vi.fn();
    render(<DetailPattern title="X" sections={sections} back={{ label: 'Zur Liste', onClick: back }} />);
    await userEvent.tab();
    expect(screen.getByRole('button', { name: /Zur Liste/ })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(back).toHaveBeenCalledTimes(1);
  });
});
