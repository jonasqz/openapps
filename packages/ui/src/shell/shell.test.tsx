import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell.tsx';
import { AppSwitcher } from './AppSwitcher.tsx';
import { NotificationBell } from './NotificationBell.tsx';
import { UserMenu, initialsOf } from './UserMenu.tsx';
import type { ShellApp, ShellNavGroup, ShellNotification, ShellUser } from './types.ts';

const user: ShellUser = {
  id: 'u1',
  email: 'anna.beispiel@firma.de',
  name: 'Anna Beispiel',
  groups: ['vertrieb', 'alle'],
};

const apps: readonly ShellApp[] = [
  { id: 'urlaub', name: 'Urlaub', href: '/urlaub', category: 'Personal', current: true },
  { id: 'spesen', name: 'Spesen', href: '/spesen', category: 'Personal' },
  { id: 'crm', name: 'Kunden', href: '/crm', category: 'Vertrieb' },
];

const nav: readonly ShellNavGroup[] = [
  {
    title: 'Urlaub',
    items: [
      { id: 'offen', label: 'Offene Anträge', href: '/urlaub', badge: 3, current: true },
      { id: 'kalender', label: 'Kalender', href: '/urlaub/kalender' },
    ],
  },
];

const notifications: readonly ShellNotification[] = [
  { id: 'n1', title: 'Antrag genehmigt', at: '2026-11-09 09:00', read: false },
  { id: 'n2', title: 'Neue Spesenregel', at: '2026-11-08 17:30', read: true },
];

describe('AppShell', () => {
  it('hat eine sinnvolle Fokus-Reihenfolge: Sprungmarke, Menü, Wechsler, Meldungen, Profil', async () => {
    render(
      <AppShell appName="Urlaub" apps={apps} nav={nav} user={user} notifications={notifications}>
        <h1>Inhalt</h1>
      </AppShell>,
    );
    const order: string[] = [];
    for (let step = 0; step < 5; step += 1) {
      await userEvent.tab();
      const active = document.activeElement;
      order.push(active?.getAttribute('aria-label') ?? active?.textContent ?? '');
    }
    expect(order[0]).toContain('Zum Inhalt springen');
    expect(order[1]).toContain('Navigation öffnen');
    expect(order[2]).toContain('Urlaub');
    expect(order[3]).toContain('Benachrichtigungen');
    expect(order[4]).toContain('Anna Beispiel');
  });

  it('springt mit der Sprungmarke in den Inhalt', async () => {
    render(
      <AppShell appName="Urlaub" user={user}>
        <h1>Inhalt</h1>
      </AppShell>,
    );
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    expect(document.activeElement?.tagName).toBe('MAIN');
  });

  it('nimmt den Nutzer als Prop und baut keinen Login', () => {
    render(
      <AppShell appName="Urlaub" user={null}>
        <p>Inhalt</p>
      </AppShell>,
    );
    expect(screen.getByText('Nicht angemeldet')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Passwort/i)).not.toBeInTheDocument();
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it('öffnet auf Phone-Breite die Navigations-Schublade mit Fokusfalle', async () => {
    render(
      <AppShell appName="Urlaub" nav={nav} user={user}>
        <p>Inhalt</p>
      </AppShell>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Navigation öffnen' }));
    const drawer = screen.getByRole('dialog', { name: 'Navigation von Urlaub' });
    expect(drawer).toHaveAttribute('aria-modal', 'true');
    expect(drawer.contains(document.activeElement)).toBe(true);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Navigation von Urlaub' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Navigation öffnen' })).toHaveFocus();
  });

  it('markiert den aktuellen Navigationseintrag', () => {
    render(
      <AppShell appName="Urlaub" nav={nav} user={user}>
        <p>Inhalt</p>
      </AppShell>,
    );
    const links = screen.getAllByRole('link', { name: /Offene Anträge/ });
    expect(links[0]).toHaveAttribute('aria-current', 'page');
  });

  it('meldet Navigation über onNavigate statt den Browser zu laden', async () => {
    const onNavigate = vi.fn();
    render(
      <AppShell appName="Urlaub" nav={nav} user={user} onNavigate={onNavigate}>
        <p>Inhalt</p>
      </AppShell>,
    );
    await userEvent.click(screen.getAllByRole('link', { name: 'Kalender' })[0]!);
    expect(onNavigate).toHaveBeenCalledWith('/urlaub/kalender');
  });

  it('kommt ohne Navigation und ohne Apps zurecht', () => {
    render(
      <AppShell appName="Allein" user={user}>
        <p>Inhalt</p>
      </AppShell>,
    );
    expect(screen.queryByRole('button', { name: 'Navigation öffnen' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /App wechseln/ })).toBeInTheDocument();
  });
});

describe('AppSwitcher', () => {
  it('öffnet das Menü mit Pfeil-ab und wandert mit Pfeiltasten', async () => {
    render(<AppSwitcher apps={apps} />);
    await userEvent.tab();
    await userEvent.keyboard('{ArrowDown}');
    const menu = screen.getByRole('menu');
    const items = within(menu).getAllByRole('menuitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(items[1]).toHaveFocus();
  });

  it('gruppiert nach Kategorie und markiert die aktuelle App', async () => {
    render(<AppSwitcher apps={apps} />);
    await userEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('group', { name: 'Personal' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Vertrieb' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Urlaub/ })).toHaveAttribute('aria-current', 'page');
  });

  it('schließt mit Escape und gibt den Fokus zurück', async () => {
    render(<AppSwitcher apps={apps} />);
    const button = screen.getByRole('button');
    await userEvent.click(button);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it('sagt es, wenn keine App freigegeben ist', async () => {
    render(<AppSwitcher apps={[]} currentName="Urlaub" />);
    await userEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Keine App freigegeben')).toBeInTheDocument();
  });

  it('trägt zwanzig Apps ohne die Fläche zu sprengen', async () => {
    const many = Array.from({ length: 20 }, (_, index) => ({
      id: `a${index}`,
      name: `App ${index}`,
      href: `/a${index}`,
      category: index % 2 === 0 ? 'Personal' : 'Vertrieb',
    }));
    render(<AppSwitcher apps={many} currentName="App 0" />);
    await userEvent.click(screen.getByRole('button'));
    expect(within(screen.getByRole('menu')).getAllByRole('menuitem')).toHaveLength(20);
    expect(screen.getByRole('menu').className).toContain('overflow-y-auto');
  });
});

describe('NotificationBell', () => {
  it('nennt die Zahl ungelesener Meldungen im Namen, nicht nur in Farbe', () => {
    render(<NotificationBell notifications={notifications} />);
    expect(screen.getByRole('button', { name: 'Benachrichtigungen, 1 ungelesen' })).toBeInTheDocument();
  });

  it('zeigt den leeren Zustand', async () => {
    render(<NotificationBell notifications={[]} />);
    await userEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Nichts Neues')).toBeInTheDocument();
  });

  it('zeigt den Fehlerzustand', async () => {
    render(<NotificationBell notifications={[]} error="Gateway nicht erreichbar" />);
    await userEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('alert')).toHaveTextContent('Gateway nicht erreichbar');
  });

  it('zeigt den Ladezustand', async () => {
    render(<NotificationBell notifications={[]} loading />);
    await userEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('status')).toHaveTextContent('Benachrichtigungen werden geladen …');
  });
});

describe('UserMenu', () => {
  it('bildet Initialen aus Name oder E-Mail', () => {
    expect(initialsOf(user)).toBe('AB');
    expect(initialsOf({ id: 'x', email: 'max@firma.de' })).toBe('MF');
    expect(initialsOf({ id: 'x', email: 'max@firma.de', initials: 'mx' })).toBe('MX');
  });

  it('zeigt Profil und Abmelden nur, wenn es sie gibt', async () => {
    const onSignOut = vi.fn();
    render(<UserMenu user={user} onSignOut={onSignOut} />);
    await userEvent.click(screen.getByRole('button'));
    expect(screen.queryByRole('menuitem', { name: 'Profil' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Abmelden' }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it('zeigt einen Platzhalter, solange der Nutzer nicht geladen ist', () => {
    render(<UserMenu user={null} />);
    expect(screen.getByText('Nicht angemeldet')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
