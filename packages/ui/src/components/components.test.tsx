import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Badge } from './Badge.tsx';
import { Button } from './Button.tsx';
import { Checkbox } from './Checkbox.tsx';
import { Dialog } from './Dialog.tsx';
import { EmptyState } from './EmptyState.tsx';
import { ErrorState } from './ErrorState.tsx';
import { Input } from './Input.tsx';
import { Pagination, pageCount } from './Pagination.tsx';
import { Select } from './Select.tsx';
import { Spinner } from './Spinner.tsx';
import { Table, fieldContent } from './Table.tsx';
import { Tabs } from './Tabs.tsx';
import { ToastProvider, useToast, TOAST_LIMIT } from './Toast.tsx';
import { overrideStrings, resetStrings } from '../strings.ts';

const LONG = 'Sehr'.repeat(60);

describe('Button', () => {
  it('ist mit der Tastatur bedienbar', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Speichern</Button>);
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Speichern' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('blockt Klicks während lädt und meldet aria-busy', async () => {
    const onClick = vi.fn();
    render(
      <Button loading loadingLabel="Wird gespeichert …" onClick={onClick}>
        Speichern
      </Button>,
    );
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Wird gespeichert …')).toBeInTheDocument();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('bricht sehr langen Text um statt den Knopf zu sprengen', () => {
    render(<Button>{LONG}</Button>);
    const button = screen.getByRole('button');
    expect(button.className).toContain('overflow-hidden');
    expect(screen.getByText(LONG).className).toContain('break-words');
  });
});

describe('Input', () => {
  it('verbindet Label, Hilfetext und Fehlermeldung mit dem Feld', () => {
    render(<Input label="E-Mail" hint="Dienstliche Adresse" error="Bitte ausfüllen." required />);
    const input = screen.getByLabelText(/E-Mail/);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const described = input.getAttribute('aria-describedby') ?? '';
    expect(described.split(' ')).toHaveLength(2);
    expect(screen.getByRole('alert')).toHaveTextContent('Bitte ausfüllen.');
  });

  it('setzt kein aria-invalid ohne Fehler', () => {
    render(<Input label="Name" />);
    expect(screen.getByLabelText('Name')).not.toHaveAttribute('aria-invalid');
  });
});

describe('Select', () => {
  it('ist leer und deaktiviert, wenn es keine Optionen gibt', () => {
    render(<Select label="Status" options={[]} />);
    const select = screen.getByLabelText('Status');
    expect(select).toBeDisabled();
    expect(screen.getByText('Keine Auswahl verfügbar')).toBeInTheDocument();
  });

  it('trägt sehr viele Optionen', () => {
    const options = Array.from({ length: 300 }, (_, index) => ({
      value: String(index),
      label: `Eintrag ${index}`,
    }));
    render(<Select label="Viele" options={options} />);
    expect(within(screen.getByLabelText('Viele')).getAllByRole('option')).toHaveLength(300);
  });
});

describe('Checkbox', () => {
  it('wechselt mit der Leertaste', async () => {
    render(<Checkbox label="Ich stimme zu" />);
    const box = screen.getByRole('checkbox', { name: 'Ich stimme zu' });
    await userEvent.tab();
    expect(box).toHaveFocus();
    await userEvent.keyboard(' ');
    expect(box).toBeChecked();
  });
});

describe('Table', () => {
  const columns = [
    { key: 'name', header: 'Name', cell: (row: { name: string }) => row.name },
  ];

  it('zeigt den leeren Zustand', () => {
    render(
      <Table
        caption="Nutzer"
        columns={columns}
        rows={[]}
        rowKey={(_, index) => String(index)}
        empty={{ title: 'Noch keine Nutzer' }}
      />,
    );
    expect(screen.getByText('Noch keine Nutzer')).toBeInTheDocument();
  });

  it('zeigt den Fehlerzustand statt der Tabelle', () => {
    render(
      <Table
        caption="Nutzer"
        columns={columns}
        rows={[]}
        rowKey={(_, index) => String(index)}
        error={{ title: 'Laden fehlgeschlagen' }}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Laden fehlgeschlagen');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('meldet den Ladezustand als aria-busy', () => {
    const { container } = render(
      <Table caption="Nutzer" columns={columns} rows={[]} rowKey={() => 'x'} loading />,
    );
    expect(container.querySelector('tbody')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('trägt viele Zeilen und sehr langen Text', () => {
    const rows = Array.from({ length: 500 }, (_, index) => ({ name: `${LONG}-${index}` }));
    render(<Table caption="Viele" columns={columns} rows={rows} rowKey={(row) => row.name} />);
    expect(screen.getAllByRole('row')).toHaveLength(501);
  });
});

/**
 * Die serverfähige Form: Spalten nennen ein `field`, `rowKey` einen Feldnamen
 * oder nichts. Keine Funktion geht über die Server/Client-Grenze — genau
 * daran brach der Build des Starter-Templates.
 */
describe('Table ohne Funktions-Props', () => {
  interface User extends Record<string, unknown> {
    id: string;
    name: string;
    tage: number;
  }

  const rows: readonly User[] = [
    { id: 'a', name: 'Anna', tage: 3 },
    { id: 'b', name: 'Bert', tage: 11 },
  ];

  it('gibt dasselbe aus wie die Form mit cell', () => {
    const withField = render(
      <Table<User>
        caption="Nutzer"
        rows={rows}
        columns={[
          { field: 'name', header: 'Name' },
          { field: 'tage', header: 'Tage', align: 'right' },
        ]}
      />,
    ).container.innerHTML;

    const withCell = render(
      <Table<User>
        caption="Nutzer"
        rows={rows}
        rowKey={(row) => row.id}
        columns={[
          { key: 'name', header: 'Name', cell: (row) => row.name },
          { key: 'tage', header: 'Tage', align: 'right', cell: (row) => row.tage },
        ]}
      />,
    ).container.innerHTML;

    expect(withField).toBe(withCell);
  });

  it('nimmt ohne rowKey das Feld id und sonst einen anderen Feldnamen', () => {
    const { container } = render(
      <Table<User> caption="Nutzer" rows={rows} columns={[{ field: 'name', header: 'Name' }]} />,
    );
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);

    const named = render(
      <Table<User>
        caption="Nutzer"
        rows={rows}
        rowKey="name"
        columns={[{ field: 'name', header: 'Name' }]}
      />,
    );
    expect(named.container.querySelectorAll('tbody tr')).toHaveLength(2);
  });

  it('formatiert Werte, die React nicht selbst rendern kann', () => {
    expect(fieldContent(null)).toBe('—');
    expect(fieldContent(undefined)).toBe('—');
    expect(fieldContent('')).toBe('—');
    expect(fieldContent(new Date('2026-11-09T22:30:00Z'))).toBe('09.11.2026');
    expect(fieldContent(new Date('kaputt'))).toBe('—');
    expect(fieldContent(true)).toBe('Ja');
    expect(fieldContent(false)).toBe('Nein');
    expect(fieldContent(0)).toBe(0);
    expect(fieldContent(7n)).toBe('7');
    expect(fieldContent('Anna')).toBe('Anna');
  });

  it('zeigt leere Felder und Daten in der Zelle', () => {
    interface Row2 extends Record<string, unknown> {
      id: string;
      domain: string | null;
      angelegt: Date;
    }
    render(
      <Table<Row2>
        caption="Apps"
        rows={[{ id: 'x', domain: null, angelegt: new Date('2026-01-02T00:00:00Z') }]}
        columns={[
          { field: 'domain', header: 'Domain' },
          { field: 'angelegt', header: 'Angelegt' },
        ]}
      />,
    );
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('02.01.2026')).toBeInTheDocument();
  });
});

describe('Pagination', () => {
  it('rechnet Seiten und sperrt die Ränder', () => {
    expect(pageCount(0, 20)).toBe(1);
    expect(pageCount(41, 20)).toBe(3);
    render(<Pagination page={1} pageSize={20} total={41} onPageChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Zurück' })).toBeDisabled();
    expect(screen.getByText('1–20 von 41 · Seite 1 von 3')).toBeInTheDocument();
  });

  it('sagt bei leerer Liste, dass es nichts gibt', () => {
    render(<Pagination page={1} pageSize={20} total={0} onPageChange={() => {}} />);
    expect(screen.getByText('Keine Einträge')).toBeInTheDocument();
  });
});

describe('Tabs', () => {
  const items = [
    { id: 'a', label: 'Offen', content: <p>Inhalt A</p> },
    { id: 'b', label: 'Erledigt', content: <p>Inhalt B</p> },
  ];

  it('wandert mit Pfeiltasten und wählt mit Enter', async () => {
    render(<Tabs label="Bereiche" items={items} />);
    await userEvent.tab();
    expect(screen.getByRole('tab', { name: 'Offen' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Erledigt' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('tab', { name: 'Erledigt' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Inhalt B')).toBeInTheDocument();
  });

  it('kommt mit null Reitern zurecht', () => {
    render(<Tabs label="Leer" items={[]} />);
    expect(screen.getByText('Keine Reiter vorhanden')).toBeInTheDocument();
  });
});

describe('Dialog', () => {
  function Harness(): JSX.Element {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Öffnen
        </button>
        <Dialog open={open} onClose={() => setOpen(false)} title="Löschen?" description="Dauerhaft.">
          <p>Inhalt</p>
        </Dialog>
      </>
    );
  }

  it('fängt den Fokus, schließt mit Escape und gibt den Fokus zurück', async () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Öffnen' });
    await userEvent.click(opener);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Löschen?');
    expect(document.activeElement).not.toBe(opener);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});

describe('Toast', () => {
  function Harness(): JSX.Element {
    const toast = useToast();
    return (
      <button type="button" onClick={() => toast.show({ title: 'Gespeichert', tone: 'success' })}>
        Melden
      </button>
    );
  }

  it('zeigt eine Meldung und lässt sie schließen', async () => {
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Melden' }));
    expect(screen.getByRole('status')).toHaveTextContent('Gespeichert');
    await userEvent.click(screen.getByRole('button', { name: /Gespeichert.*schließen/ }));
    expect(screen.queryByText('Gespeichert')).not.toBeInTheDocument();
  });

  it('begrenzt die Zahl gleichzeitiger Meldungen', async () => {
    function Many(): JSX.Element {
      const toast = useToast();
      return (
        <button
          type="button"
          onClick={() => {
            for (let index = 0; index < TOAST_LIMIT + 3; index += 1) {
              toast.show({ title: `Meldung ${index}`, duration: 0 });
            }
          }}
        >
          Viele
        </button>
      );
    }
    render(
      <ToastProvider>
        <Many />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Viele' }));
    expect(screen.getAllByRole('status')).toHaveLength(TOAST_LIMIT);
  });
});

describe('Zustände leer und Fehler', () => {
  it('EmptyState trägt eine Überschrift und einen Ausweg', () => {
    render(<EmptyState title="Noch nichts da" description="Legen Sie den ersten Eintrag an." action={<Button>Neu</Button>} />);
    expect(screen.getByRole('heading', { name: 'Noch nichts da' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Neu' })).toBeInTheDocument();
  });

  it('ErrorState kündigt sich als alert an und zeigt die Kennung', () => {
    render(<ErrorState title="Nicht geladen" correlationId="abc-123" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Nicht geladen');
    expect(screen.getByText('abc-123')).toBeInTheDocument();
  });
});

describe('Badge und Spinner', () => {
  it('Badge nennt den Status auch in Worten', () => {
    render(<Badge tone="danger" srPrefix="Status: ">Abgelehnt</Badge>);
    expect(screen.getByText('Status:')).toBeInTheDocument();
    expect(screen.getByText('Abgelehnt')).toBeInTheDocument();
  });

  it('Spinner ist für Screenreader beschriftet', () => {
    render(<Spinner label="Daten werden geladen …" />);
    expect(screen.getByRole('status')).toHaveTextContent('Daten werden geladen …');
  });
});

describe('Texte aus src/strings.ts', () => {
  afterEach(() => {
    resetStrings();
  });

  it('eine Komponente zeigt den ersetzten Text', () => {
    overrideStrings({ select: { empty: 'Nichts zur Auswahl' } });
    render(<Select label="Status" options={[]} />);
    expect(screen.getByText('Nichts zur Auswahl')).toBeInTheDocument();
  });

  it('die Prop gewinnt gegen den ersetzten Text', () => {
    overrideStrings({ select: { empty: 'Nichts zur Auswahl' } });
    render(<Select label="Status" options={[]} emptyLabel="Keine Rolle freigegeben" />);
    expect(screen.getByText('Keine Rolle freigegeben')).toBeInTheDocument();
  });

  it('resetStrings stellt den ausgelieferten Text wieder her', () => {
    overrideStrings({ pagination: { empty: 'Leer' } });
    resetStrings();
    render(<Pagination page={1} pageSize={20} total={0} onPageChange={() => {}} />);
    expect(screen.getByText('Keine Einträge')).toBeInTheDocument();
  });
});
