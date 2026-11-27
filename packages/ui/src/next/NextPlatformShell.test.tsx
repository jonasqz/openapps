import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sectionNav, withBasePath, withoutBasePath, type AppSection } from '../shell/sections.ts';
import { ThemeScript } from '../shell/ThemeScript.tsx';
import { themeScript } from '../shell/platform.ts';
import type { ShellPlatform, ShellUser } from '../shell/types.ts';

/**
 * Die Anbindung einer Next-App an die gemeinsame Leiste (ADR 0019). Riskant
 * ist: ein falscher aktueller Eintrag, ein Router-Aufruf mit doppeltem
 * basePath (kaputte Seite) und Links zu anderen Apps, die ueber den
 * Client-Router der eigenen App laufen.
 */

const navigation = vi.hoisted(() => ({ pathname: '/', push: vi.fn() }));

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: navigation.push }),
}));

const { NextPlatformShell } = await import('./NextPlatformShell.tsx');

const SECTIONS = [
  { id: 'pipeline', label: 'Pipeline', path: '/', match: ['/', '/deals'] },
  { id: 'companies', label: 'Companies', path: '/companies' },
  { id: 'contacts', label: 'Contacts', path: '/contacts', match: ['/contacts'] },
] as const satisfies readonly AppSection[];

const platform: ShellPlatform = {
  platformUrl: 'https://admin.example.test',
  apps: [
    { name: 'crm', title: 'CRM', category: null, href: 'https://apps.example.test/crm' },
    { name: 'tasks', title: 'Tasks', category: null, href: 'https://apps.example.test/tasks' },
  ],
  canCreateApps: false,
  isAdmin: false,
};

const user: ShellUser = { id: 'u1', email: 'anna@example.com', groups: ['team'] };

function renderShell(props: { basePath?: string; platform?: ShellPlatform | null } = {}): void {
  render(
    <NextPlatformShell
      appName="crm"
      appTitle="CRM"
      platform={props.platform === undefined ? platform : props.platform}
      user={user}
      basePath={props.basePath ?? '/crm'}
      sections={SECTIONS}
    >
      <h1>Content</h1>
    </NextPlatformShell>,
  );
}

beforeEach(() => {
  navigation.pathname = '/';
  navigation.push.mockReset();
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sectionNav', () => {
  it('markiert hoechstens einen Eintrag, `/` nur exakt', () => {
    const items = (pathname: string) =>
      sectionNav(SECTIONS, pathname, '/crm')[0]!.items.filter((item) => item.current).map((item) => item.id);
    expect(items('/')).toEqual(['pipeline']);
    expect(items('/deals/42')).toEqual(['pipeline']);
    expect(items('/companies')).toEqual(['companies']);
    expect(items('/companies/7/edit')).toEqual(['companies']);
    // Nur ein Praefix im Namen ist keine Unterseite.
    expect(items('/companies-archive')).toEqual([]);
    expect(items('/settings')).toEqual([]);
  });

  it('nimmt ohne `match` den eigenen Pfad', () => {
    const [group] = sectionNav([{ id: 'items', label: 'Items', path: '/items' }], '/items/3', '');
    expect(group!.items[0]).toMatchObject({ href: '/items', current: true });
  });

  it('setzt den basePath vor jede Adresse, lokal ohne', () => {
    expect(sectionNav(SECTIONS, '/', '/crm')[0]!.items.map((item) => item.href)).toEqual([
      '/crm',
      '/crm/companies',
      '/crm/contacts',
    ]);
    expect(sectionNav(SECTIONS, '/', '')[0]!.items.map((item) => item.href)).toEqual(['/', '/companies', '/contacts']);
  });

  it('liefert fuer eine App ohne Bereiche eine leere Gruppe', () => {
    expect(sectionNav([], '/', '/crm')).toEqual([{ items: [] }]);
  });
});

describe('withBasePath und withoutBasePath', () => {
  it('sind zueinander umkehrbar', () => {
    for (const path of ['/', '/companies', '/companies/7']) {
      expect(withoutBasePath('/crm', withBasePath('/crm', path))).toBe(path);
      expect(withoutBasePath('', withBasePath('', path))).toBe(path);
    }
  });

  it('laesst Adressen ausserhalb der App unveraendert', () => {
    expect(withoutBasePath('/crm', '/crmx/companies')).toBe('/crmx/companies');
    expect(withoutBasePath('/crm', '/tasks')).toBe('/tasks');
  });
});

describe('NextPlatformShell', () => {
  it('markiert die aktuelle Seite nach usePathname', () => {
    navigation.pathname = '/companies/7';
    renderShell();
    const apps = screen.getByRole('navigation', { name: 'Apps' });
    expect(within(apps).getByRole('link', { name: 'Companies' })).toHaveAttribute('aria-current', 'page');
    expect(within(apps).getByRole('link', { name: 'Companies' })).toHaveAttribute('href', '/crm/companies');
    expect(within(apps).getByRole('link', { name: 'Pipeline' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('heading', { name: 'Content' })).toBeInTheDocument();
  });

  it('navigiert innerhalb der App ueber den Router, ohne den basePath doppelt zu setzen', async () => {
    renderShell();
    const apps = screen.getByRole('navigation', { name: 'Apps' });
    await userEvent.click(within(apps).getByRole('link', { name: 'Contacts' }));
    expect(navigation.push).toHaveBeenCalledWith('/contacts');
    await userEvent.click(within(apps).getByRole('link', { name: 'Pipeline' }));
    expect(navigation.push).toHaveBeenLastCalledWith('/');
  });

  it('fuehrt Links zu anderen Apps nicht ueber den Router der eigenen App', async () => {
    renderShell();
    const apps = screen.getByRole('navigation', { name: 'Apps' });
    const tasks = within(apps).getByRole('link', { name: 'Tasks' });
    expect(tasks).toHaveAttribute('href', 'https://apps.example.test/tasks');
    // jsdom navigiert nicht; es zaehlt nur, dass der Router nicht gerufen wird.
    tasks.addEventListener('click', (event) => event.preventDefault());
    await userEvent.click(tasks);
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it('zeigt ohne Plattform-Daten nur die eigene App mit ihren Bereichen', () => {
    renderShell({ platform: null });
    const apps = screen.getByRole('navigation', { name: 'Apps' });
    expect(within(apps).getByText('CRM')).toBeInTheDocument();
    expect(within(apps).getByRole('link', { name: 'Companies' })).toBeInTheDocument();
    expect(screen.queryByText('Tasks')).not.toBeInTheDocument();
  });

  it('funktioniert lokal ohne basePath', async () => {
    navigation.pathname = '/contacts';
    renderShell({ basePath: '' });
    const apps = screen.getByRole('navigation', { name: 'Apps' });
    expect(within(apps).getByRole('link', { name: 'Contacts' })).toHaveAttribute('href', '/contacts');
    await userEvent.click(within(apps).getByRole('link', { name: 'Companies' }));
    expect(navigation.push).toHaveBeenCalledWith('/companies');
  });
});

describe('ThemeScript', () => {
  it('rendert genau das Skript aus themeScript', () => {
    expect(renderToStaticMarkup(<ThemeScript />)).toBe(`<script>${themeScript}</script>`);
  });
});
