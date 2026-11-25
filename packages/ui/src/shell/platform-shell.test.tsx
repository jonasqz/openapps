import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformShell } from './PlatformShell.tsx';
import { THEME_STORAGE_KEY, monogramOf, monogramTone, newAppCommand, safeHref } from './platform.ts';
import type { ShellNavGroup, ShellPlatform, ShellUser } from './types.ts';

const user: ShellUser = { id: 'u1', email: 'anna@example.com', name: 'Anna Example' };

const PLATFORM_URL = 'https://admin.example.test';

const platform: ShellPlatform = {
  platformUrl: PLATFORM_URL,
  apps: [
    { name: 'crm', title: 'CRM', category: 'Sales', href: 'https://apps.example.test/crm' },
    { name: 'tasks', title: 'Tasks', category: null, href: 'https://apps.example.test/tasks' },
    { name: 'leave', title: 'Leave', category: 'People', href: 'https://apps.example.test/leave' },
  ],
  canCreateApps: true,
  isAdmin: false,
};

const sections: readonly ShellNavGroup[] = [
  {
    title: 'Companies',
    items: [
      { id: 'all', label: 'All companies', href: '/crm/companies', current: true },
      { id: 'new', label: 'New company', href: '/crm/companies/new' },
    ],
  },
];

function renderShell(props: Partial<Parameters<typeof PlatformShell>[0]> = {}): ReturnType<typeof render> {
  return render(
    <PlatformShell platform={platform} appName="crm" appTitle="CRM" sections={sections} user={user} {...props}>
      <h1>Content</h1>
    </PlatformShell>,
  );
}

/** Jede gerenderte Adresse ist http(s) oder pfadrelativ — nie ein Skript. */
function expectOnlySafeHrefs(container: HTMLElement): void {
  for (const anchor of Array.from(container.ownerDocument.querySelectorAll('a[href]'))) {
    const href = anchor.getAttribute('href') ?? '';
    if (href.startsWith('#')) continue; // Sprungmarke zum Inhalt
    expect(href, anchor.outerHTML).toMatch(/^(https?:\/\/[^/\\]|\/(?![/\\]))/i);
  }
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PlatformShell ohne Plattform-Daten', () => {
  it('zeigt nur die eigene App mit ihren Bereichen und keinen Link zur Plattform', () => {
    renderShell({ platform: null });
    const apps = screen.getByRole('navigation', { name: 'Apps' });
    expect(within(apps).getByText('CRM')).toBeInTheDocument();
    expect(within(apps).getByRole('link', { name: 'All companies' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByText('Tasks')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New app' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'New agent' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
    expect(document.querySelector('a[href^="https://"]')).toBeNull();
  });

  it('behandelt eine Plattform-Adresse mit javascript: wie keine Plattform', () => {
    renderShell({ platform: { ...platform, platformUrl: 'javascript:alert(1)', isAdmin: true } });
    expect(screen.queryByRole('button', { name: 'New app' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
    expectOnlySafeHrefs(document.body);
  });
});

describe('PlatformShell mit Apps', () => {
  it('listet die anderen Apps als Links und klappt die aktuelle mit ihren Bereichen auf', () => {
    renderShell();
    const apps = screen.getByRole('navigation', { name: 'Apps' });
    expect(within(apps).getByRole('link', { name: 'Tasks' })).toHaveAttribute('href', 'https://apps.example.test/tasks');
    expect(within(apps).getByRole('link', { name: 'Leave' })).toHaveAttribute('href', 'https://apps.example.test/leave');

    const current = within(apps).getByRole('link', { name: 'CRM' });
    expect(current).toHaveAttribute('aria-current', 'true');
    // Die Bereiche stehen direkt unter der aktuellen App.
    const currentItem = current.closest('li');
    expect(currentItem).not.toBeNull();
    expect(within(currentItem!).getByRole('link', { name: 'All companies' })).toHaveAttribute('aria-current', 'page');
    expect(within(currentItem!).getByRole('link', { name: 'New company' })).not.toHaveAttribute('aria-current');
    // Andere Apps zeigen keine Bereiche.
    const tasksItem = within(apps).getByRole('link', { name: 'Tasks' }).closest('li');
    expect(within(tasksItem!).queryAllByRole('link')).toHaveLength(1);
  });

  it('zeigt die eigene App auch, wenn die Plattform sie nicht kennt', () => {
    renderShell({ appName: 'notes', appTitle: 'Notes' });
    const apps = screen.getByRole('navigation', { name: 'Apps' });
    expect(within(apps).getByText('Notes')).toBeInTheDocument();
    expect(within(apps).getByRole('link', { name: 'All companies' })).toBeInTheDocument();
  });

  it('zeigt einen leeren Zustand, wenn die App keine Bereiche hat', () => {
    renderShell({ sections: [] });
    expect(screen.getByText('No pages yet')).toBeInTheDocument();
  });

  it('gruppiert erst ab vielen Apps nach Kategorie', () => {
    const { unmount } = renderShell();
    expect(screen.queryByText('Sales')).not.toBeInTheDocument();
    unmount();

    const many: ShellPlatform = {
      ...platform,
      apps: [
        ...platform.apps,
        ...Array.from({ length: 7 }, (_, index) => ({
          name: `app${index}`,
          title: `App ${index}`,
          category: index % 2 === 0 ? 'Operations' : null,
          href: `https://apps.example.test/app${index}`,
        })),
      ],
    };
    renderShell({ platform: many });
    const apps = screen.getByRole('navigation', { name: 'Apps' });
    expect(within(apps).getByText('Sales')).toBeInTheDocument();
    expect(within(apps).getByText('Operations')).toBeInTheDocument();
    // Ohne Kategorie: eigene Gruppe am Schluss.
    const labels = Array.from(apps.querySelectorAll('p')).map((node) => node.textContent);
    expect(labels.at(-1)).toBe('Apps');
  });

  it('ruft onNavigate nur fuer Bereiche der App, nicht fuer andere Apps', async () => {
    const onNavigate = vi.fn();
    renderShell({ onNavigate });
    await userEvent.click(screen.getByRole('link', { name: 'New company' }));
    expect(onNavigate).toHaveBeenCalledWith('/crm/companies/new');
    onNavigate.mockClear();
    const tasks = screen.getByRole('link', { name: 'Tasks' });
    tasks.addEventListener('click', (event) => event.preventDefault());
    await userEvent.click(tasks);
    expect(onNavigate).not.toHaveBeenCalled();
  });
});

describe('Links zur Plattform', () => {
  it('fuehren zu platformUrl, auch mit Schraegstrich am Ende', async () => {
    renderShell({ platform: { ...platform, platformUrl: `${PLATFORM_URL}/`, isAdmin: true } });
    expect(screen.getByRole('link', { name: 'New agent' })).toHaveAttribute('href', `${PLATFORM_URL}/agents`);
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', `${PLATFORM_URL}/settings`);
    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute('href', PLATFORM_URL);

    await userEvent.click(screen.getByRole('button', { name: /Account menu/ }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Settings' })).toHaveAttribute('href', `${PLATFORM_URL}/settings`);
    expect(within(menu).getByRole('menuitem', { name: 'Get started' })).toHaveAttribute('href', `${PLATFORM_URL}/get-started`);
    expect(within(menu).getByRole('menuitem', { name: 'Sign out' })).toHaveAttribute('href', `${PLATFORM_URL}/sign-out`);
  });

  it('zeigt Admin nur fuer Admins', () => {
    renderShell();
    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
  });
});

describe('Sicherheit der Adressen', () => {
  it('rendert nie javascript:, data: oder fremde protokollrelative Adressen', () => {
    renderShell({
      platform: {
        ...platform,
        apps: [
          ...platform.apps,
          { name: 'evil', title: 'Evil', href: 'javascript:alert(1)' },
          { name: 'evil2', title: 'Evil two', href: ' JavaScript:alert(1)' },
          { name: 'evil3', title: 'Evil three', href: 'data:text/html,<script>alert(1)</script>' },
          { name: 'evil4', title: 'Evil four', href: '//evil.example' },
          { name: 'evil5', title: 'Evil five', href: '/\\evil.example' },
          { name: 'evil6', title: 'Evil six', href: 'java\nscript:alert(1)' },
        ],
      },
      sections: [
        {
          items: [
            { id: 'ok', label: 'Fine', href: '/crm' },
            { id: 'bad', label: 'Bad', href: 'javascript:alert(1)' },
          ],
        },
      ],
    });
    expect(screen.queryByText(/Evil/)).not.toBeInTheDocument();
    expect(screen.queryByText('Bad')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Fine' })).toBeInTheDocument();
    expectOnlySafeHrefs(document.body);
  });

  it('zeigt die eigene App ohne Link, wenn ihre Adresse unsicher ist', () => {
    renderShell({
      platform: { ...platform, apps: [{ name: 'crm', title: 'CRM', href: 'javascript:alert(1)' }] },
    });
    const apps = screen.getByRole('navigation', { name: 'Apps' });
    expect(within(apps).getByText('CRM')).toBeInTheDocument();
    expect(within(apps).queryByRole('link', { name: 'CRM' })).not.toBeInTheDocument();
    expectOnlySafeHrefs(document.body);
  });

  it('safeHref laesst nur http(s) und pfadrelative Adressen durch', () => {
    expect(safeHref('https://a.example/x')).toBe('https://a.example/x');
    expect(safeHref('HTTP://a.example')).toBe('HTTP://a.example');
    expect(safeHref('/crm')).toBe('/crm');
    for (const bad of ['javascript:alert(1)', ' javascript:x', 'data:x', 'vbscript:x', '//evil', '/\\evil', 'crm', '#x', '', 'https://', 'java\tscript:x', null, undefined]) {
      expect(safeHref(bad), String(bad)).toBeNull();
    }
  });
});

describe('New app', () => {
  it('fehlt ohne canCreateApps', () => {
    renderShell({ platform: { ...platform, canCreateApps: false } });
    expect(screen.queryByRole('button', { name: 'New app' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New agent' })).toBeInTheDocument();
  });

  it('erzeugt den Befehl, kopiert ihn und verweist auf get-started', async () => {
    const actor = userEvent.setup();
    renderShell();
    await actor.click(screen.getByRole('button', { name: 'New app' }));
    const dialog = screen.getByRole('dialog', { name: 'New app' });
    // Fokus steht im ersten Feld, nicht auf „Schliessen“.
    expect(within(dialog).getByLabelText('Name')).toHaveFocus();

    const copy = within(dialog).getByRole('button', { name: /Copy/ });
    expect(copy).toBeDisabled();

    await actor.type(within(dialog).getByLabelText('Name'), 'Leave requests');
    await actor.type(within(dialog).getByLabelText(/What should it do/), 'Team members request leave,{enter}leads approve it.');
    const command = '/openapps:new-app Leave requests: Team members request leave, leads approve it.';
    expect(within(dialog).getByTestId('oa-new-app-command')).toHaveTextContent(command);

    await actor.click(copy);
    await expect(navigator.clipboard.readText()).resolves.toBe(command);
    expect(await screen.findByText('Command copied')).toBeInTheDocument();

    expect(within(dialog).getByRole('link', { name: 'How to connect your assistant' })).toHaveAttribute(
      'href',
      `${PLATFORM_URL}/get-started`,
    );
  });

  it('newAppCommand baut eine Zeile, mit und ohne Namen', () => {
    expect(newAppCommand('', '  ')).toBeNull();
    expect(newAppCommand('', 'Track  leave\nrequests')).toBe('/openapps:new-app Track leave requests');
    expect(newAppCommand(' CRM: ', 'Customers')).toBe('/openapps:new-app CRM: Customers');
  });
});

describe('Nutzer, Darstellung, Einklappen', () => {
  it('zeigt ein Skelett, solange der Nutzer laedt', () => {
    renderShell({ user: null });
    const status = screen.getByRole('status', { name: '' });
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Loading account')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Account menu/ })).not.toBeInTheDocument();
  });

  it('setzt data-theme auf <html> und merkt die Wahl', async () => {
    renderShell();
    await userEvent.click(screen.getByRole('button', { name: /Account menu/ }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Dark' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(screen.getByRole('menuitemradio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');

    await userEvent.click(screen.getByRole('menuitemradio', { name: 'System' }));
    expect(document.documentElement).not.toHaveAttribute('data-theme');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('liest die gemerkte Darstellung beim Start', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    renderShell();
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
  });

  it('bleibt stabil, wenn localStorage wirft', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    renderShell();
    await userEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
  });

  it('klappt zur Spur ein und merkt es sich', async () => {
    const { unmount } = renderShell();
    await userEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(document.querySelector('aside')).toHaveAttribute('data-collapsed', 'true');
    // In der Spur bleiben App-Namen fuer Screenreader lesbar.
    expect(screen.getByRole('link', { name: 'Tasks' })).toBeInTheDocument();
    unmount();
    renderShell();
    expect(document.querySelector('aside')).toHaveAttribute('data-collapsed', 'true');
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
  });

  it('Escape schliesst erst das Nutzermenue und gibt den Fokus zurueck', async () => {
    renderShell();
    const button = screen.getByRole('button', { name: /Account menu/ });
    await userEvent.click(button);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });
});

describe('Schublade auf Phone-Breite', () => {
  it('oeffnet als Dialog mit Fokus auf der aktuellen Seite und schliesst mit Escape', async () => {
    renderShell();
    const open = screen.getByRole('button', { name: 'Open navigation' });
    await userEvent.click(open);
    const drawer = screen.getByRole('dialog', { name: 'CRM navigation' });
    expect(drawer).toHaveAttribute('aria-modal', 'true');
    expect(within(drawer).getByRole('link', { name: 'All companies' })).toHaveFocus();
    await act(async () => {
      await userEvent.keyboard('{Escape}');
    });
    expect(screen.queryByRole('dialog', { name: 'CRM navigation' })).not.toBeInTheDocument();
    expect(open).toHaveFocus();
  });

  it('beginnt mit der Sprungmarke zum Inhalt', async () => {
    renderShell();
    await userEvent.tab();
    expect(document.activeElement).toHaveTextContent('Skip to content');
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('main')).toHaveFocus();
  });
});

describe('Monogramme', () => {
  it('sind kurz und je Name fest', () => {
    expect(monogramOf('CRM')).toBe('C');
    expect(monogramOf('Leave requests')).toBe('LR');
    expect(monogramOf('   ')).toBe('?');
    expect(monogramTone('crm')).toBe(monogramTone('crm'));
  });
});
