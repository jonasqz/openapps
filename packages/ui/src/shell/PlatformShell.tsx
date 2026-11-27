'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { JSX, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { ToastProvider } from '../components/Toast.tsx';
import { cn } from '../lib/cn.ts';
import { focusRing, trapFocus } from '../lib/focus.ts';
import { strings } from '../strings.ts';
import { AdminIcon, AgentIcon, CloseIcon, MenuIcon, PlusIcon, SettingsIcon, SidebarIcon } from './icons.tsx';
import { NewAppDialog } from './NewAppDialog.tsx';
import {
  THEME_STORAGE_KEY,
  applyTheme,
  monogramOf,
  monogramTone,
  platformLink,
  readCollapsed,
  readTheme,
  safeHref,
  storeCollapsed,
  storeTheme,
} from './platform.ts';
import { SidebarUserMenu } from './SidebarUserMenu.tsx';
import { CommandPalette } from './CommandPalette.tsx';
import type { CommandItem } from './CommandPalette.tsx';
import type { PlatformSearch } from './platform-search.ts';
import { Icon } from '../components/Icon.tsx';
import { Kbd } from '../components/Kbd.tsx';
import type { ShellNavGroup, ShellNavItem, ShellPlatform, ShellTheme, ShellUser } from './types.ts';

export interface PlatformShellProps {
  /**
   * Navigation der Plattform aus `getNavigation()` (`@openapps/sdk`, ADR 0017).
   * `null`: keine oder ungueltige Daten — die Leiste zeigt nur diese App und
   * keine Links zur Plattform. Nie ein Fehler.
   */
  platform: ShellPlatform | null;
  /** Technischer Name dieser App, wie in `platform.apps[].name`. */
  appName: string;
  /** Anzeigename dieser App. */
  appTitle: string;
  /** Die eigenen Bereiche der App, eingerueckt unter ihrem Namen. */
  sections: readonly ShellNavGroup[];
  /** Angemeldete Person aus `@openapps/sdk`. `null` = laedt (Skelett). */
  user: ShellUser | null;
  /** Inhalt der App. */
  children: ReactNode;
  /**
   * Navigation innerhalb der App (Client-Router). Ohne Prop folgt der Browser
   * dem Link. Links zu anderen Apps und zur Plattform laufen nie hierueber.
   */
  onNavigate?: (href: string) => void;
  /**
   * Die Suche ueber alle Apps in der Befehlspalette (ADR 0021), meist
   * `createPlatformSearch()`. Ohne sie springt die Palette nur. Muss ueber
   * Renders stabil sein (`useMemo`), sonst sucht die Palette bei jedem
   * Render neu.
   */
  search?: PlatformSearch;
  className?: string;
}

/** Ab so vielen Apps gruppiert die Leiste nach Kategorie. */
export const PLATFORM_SHELL_GROUP_THRESHOLD = 8;

interface SidebarApp {
  name: string;
  title: string;
  category: string | null;
  href: string | null;
  current: boolean;
}

interface SidebarModel {
  groups: ReadonlyArray<{ title: string | null; apps: readonly SidebarApp[] }>;
  sections: ReadonlyArray<{ title?: string; items: readonly ShellNavItem[] }>;
  home: string | null;
  newAgent: string | null;
  admin: string | null;
  settings: string | null;
  getStarted: string | null;
  signOut: string | null;
  canCreateApps: boolean;
}

// Auf dem Server gibt es kein Layout; dort reicht useEffect und warnt nicht.
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Klick mit Strg/Cmd/Umschalt/Mittelklick oeffnet einen Tab — nicht abfangen. */
function isPlainClick(event: ReactMouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

function buildModel(
  platform: ShellPlatform | null,
  appName: string,
  appTitle: string,
  sections: readonly ShellNavGroup[],
): SidebarModel {
  const home = platformLink(platform?.platformUrl);
  const link = (path: string): string | null => (home === null ? null : platformLink(home, path));

  const apps: SidebarApp[] = [];
  let hasCurrent = false;
  for (const app of platform?.apps ?? []) {
    const current = app.name === appName;
    const href = safeHref(app.href);
    // Eine App ohne sichere Adresse faellt weg — ausser der eigenen, die
    // steht immer da, nur ohne Link.
    if (href === null && !current) continue;
    if (current) {
      if (hasCurrent) continue;
      hasCurrent = true;
    }
    apps.push({
      name: app.name,
      title: current ? appTitle : app.title,
      category: app.category ?? null,
      href,
      current,
    });
  }
  if (!hasCurrent) apps.unshift({ name: appName, title: appTitle, category: null, href: null, current: true });

  let groups: SidebarModel['groups'];
  if (apps.length > PLATFORM_SHELL_GROUP_THRESHOLD) {
    // Reihenfolge der Plattform bleibt; Apps ohne Kategorie stehen am Schluss.
    const byCategory = new Map<string | null, SidebarApp[]>();
    for (const app of apps) {
      const key = app.category === null || app.category.trim() === '' ? null : app.category;
      const list = byCategory.get(key) ?? [];
      list.push(app);
      byCategory.set(key, list);
    }
    const named = Array.from(byCategory.entries()).filter(([key]) => key !== null);
    const rest = byCategory.get(null);
    groups = [
      ...named.map(([title, list]) => ({ title, apps: list })),
      ...(rest === undefined ? [] : [{ title: named.length === 0 ? null : strings.appSwitcher.defaultCategory, apps: rest }]),
    ];
  } else {
    groups = [{ title: null, apps }];
  }

  const cleanSections = sections
    .map((group) => ({
      ...(group.title === undefined ? {} : { title: group.title }),
      items: group.items.flatMap((item) => {
        const href = safeHref(item.href);
        return href === null ? [] : [{ ...item, href }];
      }),
    }))
    .filter((group) => group.items.length > 0);

  return {
    groups,
    sections: cleanSections,
    home,
    newAgent: link('/agents'),
    admin: platform?.isAdmin === true ? home : null,
    settings: link('/settings'),
    getStarted: link('/get-started'),
    signOut: link('/sign-out'),
    canCreateApps: platform?.canCreateApps === true && home !== null,
  };
}

/**
 * Die gemeinsame Leiste jeder App (ADR 0017).
 *
 * Links eine Leiste ueber die volle Hoehe: oben die Marke, dann alle Apps,
 * die die Person sehen darf — die aktuelle aufgeklappt mit ihren Bereichen —,
 * darunter „New app“ und „New agent“, unten Admin, Settings und die
 * Nutzerkarte. Rechts der Inhalt der App.
 *
 * - Desktop: einklappbar zu einer Spur aus Kacheln (gemerkt im Browser).
 * - Unter `md`: Kopfzeile mit Menue-Knopf, die Leiste wird zur Schublade mit
 *   Fokusfalle; nichts scrollt waagerecht.
 * - Fokus-Reihenfolge: Sprungmarke, (Menue-Knopf), Marke, Einklappen, Apps
 *   mit Bereichen, New app, New agent, Admin, Settings, Nutzerkarte, Inhalt.
 * - Jede Adresse ausser http(s) und `/…` wird nicht gerendert.
 */
export function PlatformShell({
  platform,
  appName,
  appTitle,
  sections,
  user,
  children,
  onNavigate,
  search,
  className,
}: PlatformShellProps): JSX.Element {
  const baseId = useId().replace(/:/g, '');
  const mainId = `${baseId}-main`;
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [theme, setThemeState] = useState<ShellTheme>('system');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const model = useMemo(
    () => buildModel(platform, appName, appTitle, sections),
    [platform, appName, appTitle, sections],
  );

  // Gemerkte Zustaende vor dem ersten Bild nach dem Hydrieren lesen. Der
  // Server rendert immer „aufgeklappt, System“, sonst passt das HTML nicht.
  useIsomorphicLayoutEffect(() => {
    setCollapsed(readCollapsed());
    const stored = readTheme();
    setThemeState(stored);
    applyTheme(stored);
  }, []);

  // Darstellung in einem anderen Tab gewechselt: hier mitziehen.
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== THEME_STORAGE_KEY) return;
      const next = readTheme();
      setThemeState(next);
      applyTheme(next);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const changeTheme = useCallback((next: ShellTheme) => {
    setThemeState(next);
    applyTheme(next);
    storeTheme(next);
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((value) => {
      storeCollapsed(!value);
      return !value;
    });
  }, []);

  useEffect(() => {
    if (!drawerOpen) return undefined;
    const panel = drawerRef.current;
    if (panel === null) return undefined;
    const untrap = trapFocus(panel);
    // Fokus auf die aktuelle Seite, sonst auf das erste Bedienelement.
    (panel.querySelector<HTMLElement>('[aria-current="page"]') ?? panel.querySelector<HTMLElement>('a[href], button'))?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      untrap();
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      menuButtonRef.current?.focus();
    };
  }, [drawerOpen]);

  const openNewApp = useCallback(() => {
    setDrawerOpen(false);
    setDialogOpen(true);
  }, []);
  const closeNewApp = useCallback(() => setDialogOpen(false), []);

  const navigateInApp = (event: ReactMouseEvent<HTMLAnchorElement>, href: string): void => {
    if (onNavigate !== undefined && isPlainClick(event)) {
      event.preventDefault();
      onNavigate(href);
    }
    setDrawerOpen(false);
  };

  const currentApp = model.groups.flatMap((group) => group.apps).find((app) => app.current);

  // Befehlspalette (ADR 0018): Bereiche dieser App, die anderen Apps und die
  // Wege zur Plattform. Nur Anzeige und Navigation, kein eigener Rechte-Code.
  const commands = useMemo<CommandItem[]>(() => {
    const list: CommandItem[] = [];
    for (const group of model.sections) {
      for (const item of group.items) {
        list.push({
          id: `section:${item.id}`,
          label: item.label,
          href: item.href,
          group: appTitle,
          ...(item.icon === undefined ? {} : { icon: item.icon }),
        });
      }
    }
    for (const group of model.groups) {
      for (const app of group.apps) {
        if (app.current || app.href === null) continue;
        list.push({ id: `app:${app.name}`, label: app.title, href: app.href, group: strings.platformShell.appsLabel, icon: <AppTile name={app.name} title={app.title} /> });
      }
    }
    const platformGroup = strings.commandPalette.navigationGroup;
    if (model.canCreateApps) list.push({ id: 'platform:new-app', label: strings.platformShell.newApp, href: '#', group: platformGroup, icon: <Icon name="plus" /> });
    if (model.newAgent !== null) list.push({ id: 'platform:new-agent', label: strings.platformShell.newAgent, href: model.newAgent, group: platformGroup, icon: <Icon name="agents" /> });
    if (model.admin !== null) list.push({ id: 'platform:admin', label: strings.platformShell.admin, href: model.admin, group: platformGroup, icon: <Icon name="grants" /> });
    if (model.settings !== null) list.push({ id: 'platform:settings', label: strings.platformShell.settings, href: model.settings, group: platformGroup, icon: <Icon name="settings" /> });
    return list;
  }, [model, appTitle]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setDrawerOpen(false);
        setPaletteOpen((value) => !value);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const openPalette = useCallback(() => {
    setDrawerOpen(false);
    setPaletteOpen(true);
  }, []);

  const runCommand = (item: CommandItem): void => {
    if (item.id === 'platform:new-app') {
      openNewApp();
    } else if (item.id.startsWith('section:') && onNavigate !== undefined) {
      onNavigate(item.href);
    } else {
      window.location.assign(item.href);
    }
  };

  const sidebar = (rail: boolean, inDrawer: boolean): JSX.Element => (
    <Sidebar
      model={model}
      rail={rail}
      appTitle={appTitle}
      user={user}
      theme={theme}
      onThemeChange={changeTheme}
      onNewApp={openNewApp}
      onSearch={openPalette}
      onNavigateInApp={navigateInApp}
      headerAction={
        inDrawer ? (
          <IconButton label={strings.shell.closeNavigation} onClick={() => setDrawerOpen(false)}>
            <CloseIcon />
          </IconButton>
        ) : (
          <IconButton
            label={rail ? strings.platformShell.expand : strings.platformShell.collapse}
            controls={`${baseId}-sidebar`}
            onClick={toggleCollapsed}
          >
            <SidebarIcon />
          </IconButton>
        )
      }
    />
  );

  return (
    <ToastProvider>
      <div className={cn('flex min-h-screen min-w-0 bg-bg text-fg', className)}>
        <a
          href={`#${mainId}`}
          onClick={(event) => {
            event.preventDefault();
            document.getElementById(mainId)?.focus();
          }}
          className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-toast focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-fg"
        >
          {strings.shell.skipToContent}
        </a>

        <aside
          id={`${baseId}-sidebar`}
          aria-label={strings.platformShell.sidebarLabel}
          data-collapsed={collapsed ? 'true' : 'false'}
          className={cn(
            'sticky top-0 z-shell hidden h-screen shrink-0 flex-col border-r border-border bg-bg md:flex',
            collapsed ? 'w-16' : 'w-nav',
          )}
        >
          {sidebar(collapsed, false)}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-shell flex h-12 min-w-0 items-center gap-2 border-b border-border bg-bg px-2 md:hidden">
            <button
              ref={menuButtonRef}
              type="button"
              aria-expanded={drawerOpen}
              aria-controls={`${baseId}-drawer`}
              onClick={() => setDrawerOpen(true)}
              className={cn('rounded-full p-2 text-fg-muted hover:bg-surface-hover hover:text-fg', focusRing)}
            >
              <MenuIcon />
              <span className="sr-only">{strings.shell.openNavigation}</span>
            </button>
            <AppTile name={currentApp?.name ?? appName} title={appTitle} />
            <span className="min-w-0 truncate text-sm font-medium text-fg">{appTitle}</span>
          </header>

          <main id={mainId} tabIndex={-1} className="min-w-0 flex-1 p-4 outline-none sm:p-8 lg:p-10">
            {children}
          </main>
        </div>

        {drawerOpen ? (
          <div className="fixed inset-0 z-overlay md:hidden">
            <div
              aria-hidden="true"
              onClick={() => setDrawerOpen(false)}
              className="absolute inset-0 animate-oa-fade-in bg-overlay"
            />
            <div
              ref={drawerRef}
              id={`${baseId}-drawer`}
              role="dialog"
              aria-modal="true"
              aria-label={strings.shell.navigationLabel(appTitle)}
              className="relative flex h-full w-drawer max-w-[85vw] animate-oa-slide-in flex-col border-r border-border bg-bg shadow-lg"
            >
              {sidebar(false, true)}
            </div>
          </div>
        ) : null}

        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          items={commands}
          onSelect={runCommand}
          {...(search === undefined ? {} : { search })}
        />

        {model.canCreateApps ? (
          <NewAppDialog open={dialogOpen} onClose={closeNewApp} getStartedHref={model.getStarted} />
        ) : null}
      </div>
    </ToastProvider>
  );
}

interface SidebarProps {
  model: SidebarModel;
  rail: boolean;
  appTitle: string;
  user: ShellUser | null;
  theme: ShellTheme;
  onThemeChange: (theme: ShellTheme) => void;
  onNewApp: () => void;
  onSearch: () => void;
  onNavigateInApp: (event: ReactMouseEvent<HTMLAnchorElement>, href: string) => void;
  headerAction: ReactNode;
}

/** Zeile in der Leiste: Grundform fuer Apps, Bereiche und Aktionen. */
const ROW = 'group flex min-w-0 items-center gap-2.5 rounded-sm px-2 py-1.5 text-sm transition-colors duration-150';
const ROW_IDLE = 'text-fg-muted hover:bg-surface-hover hover:text-fg';
const RAIL_ROW = 'flex h-10 w-10 items-center justify-center rounded-sm transition-colors duration-150';

function Sidebar({
  model,
  rail,
  appTitle,
  user,
  theme,
  onThemeChange,
  onNewApp,
  onSearch,
  onNavigateInApp,
  headerAction,
}: SidebarProps): JSX.Element {
  const productName = strings.shell.productName;
  const mark = (
    <>
      <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center">
        <span className="h-2.5 w-2.5 bg-primary" />
      </span>
      {rail ? (
        <span className="sr-only">{productName}</span>
      ) : (
        <span className="min-w-0 truncate font-mono text-xs font-medium uppercase tracking-loose text-fg">{productName}</span>
      )}
    </>
  );

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
      <div className={cn('flex shrink-0 items-center gap-1', rail ? 'flex-col px-2 pt-3' : 'h-12 px-3')}>
        {model.home === null ? (
          <span className={cn('flex min-w-0 items-center gap-2.5', rail ? 'py-1.5' : 'flex-1 px-1')}>{mark}</span>
        ) : (
          <a
            href={model.home}
            aria-label={rail ? strings.platformShell.home : undefined}
            title={rail ? productName : undefined}
            className={cn(
              'flex min-w-0 items-center gap-1.5 rounded-sm hover:bg-surface-hover',
              rail ? 'p-2' : 'flex-1 p-1',
              focusRing,
            )}
          >
            {mark}
          </a>
        )}
        {headerAction}
      </div>

      <div className={cn('shrink-0', rail ? 'flex justify-center px-2 pt-2' : 'px-3 pt-2')}>
        {rail ? (
          <button
            type="button"
            onClick={onSearch}
            aria-haspopup="dialog"
            aria-keyshortcuts="Meta+K Control+K"
            title={strings.commandPalette.trigger}
            className={cn(RAIL_ROW, ROW_IDLE, focusRing)}
          >
            <Icon name="search" />
            <span className="sr-only">{strings.commandPalette.trigger}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onSearch}
            aria-haspopup="dialog"
            aria-keyshortcuts="Meta+K Control+K"
            className={cn(
              'flex w-full min-w-0 items-center gap-2 rounded-md border border-border bg-bg px-2.5 py-1.5 text-left text-sm text-fg-subtle',
              'transition-colors duration-150 hover:border-border-strong hover:text-fg-muted',
              focusRing,
            )}
          >
            <Icon name="search" />
            <span className="min-w-0 flex-1 truncate">{strings.commandPalette.trigger}</span>
            <Kbd aria-hidden="true">⌘K</Kbd>
          </button>
        )}
      </div>

      <nav
        aria-label={strings.platformShell.appsLabel}
        className={cn('min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-3 pt-3', rail ? 'px-2' : 'px-3')}
      >
        {model.groups.map((group, groupIndex) => (
          <div key={group.title ?? `oa-apps-${groupIndex}`} className={cn('min-w-0', groupIndex > 0 && 'mt-4')}>
            {rail ? (
              groupIndex > 0 ? <div aria-hidden="true" className="mx-auto mb-3 h-px w-6 bg-border" /> : null
            ) : (
              <p className="px-2 pb-1.5 font-mono text-2xs font-medium uppercase tracking-label text-fg-subtle">
                {group.title ?? strings.platformShell.appsLabel}
              </p>
            )}
            <ul className={cn('flex min-w-0 flex-col', rail ? 'items-center gap-1' : 'gap-0.5')}>
              {group.apps.map((app) => (
                <li key={app.name} className="min-w-0">
                  {app.current ? (
                    <CurrentApp
                      app={app}
                      appTitle={appTitle}
                      sections={model.sections}
                      rail={rail}
                      onNavigateInApp={onNavigateInApp}
                    />
                  ) : (
                    <OtherApp app={app} rail={rail} />
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}

        {model.canCreateApps || model.newAgent !== null ? (
          <div className={cn('mt-4 flex min-w-0 flex-col border-t border-border pt-3', rail ? 'items-center gap-1' : 'gap-0.5')}>
            {model.canCreateApps ? (
              <button
                type="button"
                onClick={onNewApp}
                aria-haspopup="dialog"
                title={rail ? strings.platformShell.newApp : undefined}
                className={cn(rail ? cn(RAIL_ROW, ROW_IDLE) : cn(ROW, ROW_IDLE, 'w-full text-left'), focusRing)}
              >
                <ActionGlyph>
                  <PlusIcon />
                </ActionGlyph>
                <span className={rail ? 'sr-only' : 'truncate'}>{strings.platformShell.newApp}</span>
              </button>
            ) : null}
            {model.newAgent === null ? null : (
              <a
                href={model.newAgent}
                title={rail ? strings.platformShell.newAgent : undefined}
                className={cn(rail ? cn(RAIL_ROW, ROW_IDLE) : cn(ROW, ROW_IDLE), focusRing)}
              >
                <ActionGlyph>
                  <AgentIcon />
                </ActionGlyph>
                <span className={rail ? 'sr-only' : 'truncate'}>{strings.platformShell.newAgent}</span>
              </a>
            )}
          </div>
        ) : null}
      </nav>

      <div className={cn('flex shrink-0 flex-col border-t border-border py-3', rail ? 'items-center gap-1 px-2' : 'gap-0.5 px-3')}>
        {model.admin === null ? null : (
          <FooterLink href={model.admin} label={strings.platformShell.admin} rail={rail}>
            <AdminIcon />
          </FooterLink>
        )}
        {model.settings === null ? null : (
          <FooterLink href={model.settings} label={strings.platformShell.settings} rail={rail}>
            <SettingsIcon />
          </FooterLink>
        )}
        <div className={cn('min-w-0', model.admin !== null || model.settings !== null ? 'mt-1' : '', rail ? 'w-full' : '')}>
          <SidebarUserMenu
            user={user}
            rail={rail}
            theme={theme}
            onThemeChange={onThemeChange}
            settingsHref={model.settings}
            getStartedHref={model.getStarted}
            signOutHref={model.signOut}
          />
        </div>
      </div>
    </div>
  );
}

function CurrentApp({
  app,
  appTitle,
  sections,
  rail,
  onNavigateInApp,
}: {
  app: SidebarApp;
  appTitle: string;
  sections: SidebarModel['sections'];
  rail: boolean;
  onNavigateInApp: (event: ReactMouseEvent<HTMLAnchorElement>, href: string) => void;
}): JSX.Element {
  // In der Spur nur Bereiche mit eigenem Zeichen: Buchstaben-Kacheln sahen
  // dort aus wie weitere Apps. Der Rest ist einen Klick entfernt (aufklappen).
  const railItems = sections.flatMap((group) => group.items).filter((item) => item.icon !== undefined);

  if (rail) {
    return (
      <div className="flex flex-col items-center gap-1">
        <AppLink href={app.href} current title={appTitle} className={cn(RAIL_ROW, 'bg-surface-hover')}>
          <AppTile name={app.name} title={appTitle} />
          <span className="sr-only">{appTitle}</span>
        </AppLink>
        {railItems.length === 0 ? null : (
          <ul className="flex flex-col items-center gap-0.5 pb-1">
            {railItems.map((item) => (
              <li key={item.id}>
                <a
                  href={item.href}
                  aria-current={item.current === true ? 'page' : undefined}
                  title={item.label}
                  onClick={(event) => onNavigateInApp(event, item.href)}
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-md text-2xs transition-colors duration-150',
                    item.current === true ? 'bg-surface-hover text-fg' : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
                    focusRing,
                  )}
                >
                  <span aria-hidden="true">{item.icon}</span>
                  <span className="sr-only">{item.label}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <AppLink href={app.href} current className={cn(ROW, 'font-medium text-fg', app.href !== null && 'hover:bg-surface-hover')}>
        <AppTile name={app.name} title={appTitle} />
        <span className="min-w-0 flex-1 truncate">{appTitle}</span>
      </AppLink>
      <div className="relative ml-4 mt-0.5 border-l border-border pl-2">
        {sections.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-fg-subtle">{strings.platformShell.sectionsEmpty}</p>
        ) : (
          sections.map((group, groupIndex) => (
            <div key={group.title ?? `oa-section-${groupIndex}`} className={cn('min-w-0', groupIndex > 0 && 'mt-2')}>
              {group.title === undefined || sections.length === 1 ? null : (
                <p className="px-2 pb-1 pt-1 font-mono text-2xs font-medium uppercase tracking-label text-fg-subtle">
                  {group.title}
                </p>
              )}
              <ul className="flex min-w-0 flex-col gap-px">
                {group.items.map((item) => (
                  <li key={item.id} className="min-w-0">
                    <a
                      href={item.href}
                      aria-current={item.current === true ? 'page' : undefined}
                      onClick={(event) => onNavigateInApp(event, item.href)}
                      className={cn(
                        'relative flex min-w-0 items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors duration-150',
                        item.current === true
                          ? "bg-surface-hover font-medium text-fg before:absolute before:inset-y-1 before:-left-2 before:w-0.5 before:bg-primary before:content-['']"
                          : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
                        focusRing,
                      )}
                    >
                      {item.icon === undefined ? null : (
                        <span aria-hidden="true" className="shrink-0 text-fg-muted">
                          {item.icon}
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {item.badge === undefined ? null : (
                        <span className="shrink-0 font-mono text-2xs tabular-nums text-fg-muted">
                          {item.badge > 99 ? '99+' : item.badge}
                        </span>
                      )}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function OtherApp({ app, rail }: { app: SidebarApp; rail: boolean }): JSX.Element {
  return (
    <AppLink
      href={app.href}
      title={rail ? app.title : undefined}
      className={rail ? cn(RAIL_ROW, 'hover:bg-surface-hover') : cn(ROW, ROW_IDLE)}
    >
      <AppTile name={app.name} title={app.title} />
      <span className={rail ? 'sr-only' : 'min-w-0 flex-1 truncate'}>{app.title}</span>
    </AppLink>
  );
}

/** App-Zeile: Link, wenn eine sichere Adresse da ist, sonst nur Anzeige. */
function AppLink({
  href,
  current = false,
  title,
  className,
  children,
}: {
  href: string | null;
  current?: boolean;
  title?: string | undefined;
  className: string;
  children: ReactNode;
}): JSX.Element {
  if (href === null) {
    return (
      <span className={className} title={title} aria-current={current ? 'true' : undefined}>
        {children}
      </span>
    );
  }
  return (
    <a href={href} title={title} aria-current={current ? 'true' : undefined} className={cn(className, focusRing)}>
      {children}
    </a>
  );
}

/** Kachel mit Monogramm. Ton je Name fest, nur aus Tokens. */
export function AppTile({ name, title, className }: { name: string; title: string; className?: string }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      data-tone={monogramTone(name)}
      className={cn(
        'flex h-5 w-5 shrink-0 items-center justify-center rounded-sm font-mono text-2xs font-semibold leading-none',
        monogramTone(name),
        className,
      )}
    >
      {monogramOf(title).slice(0, 2)}
    </span>
  );
}

function ActionGlyph({ children }: { children: ReactNode }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-dashed border-border-strong text-fg-muted group-hover:border-fg-muted group-hover:text-fg"
    >
      {children}
    </span>
  );
}

function FooterLink({
  href,
  label,
  rail,
  children,
}: {
  href: string;
  label: string;
  rail: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <a
      href={href}
      title={rail ? label : undefined}
      className={cn(rail ? cn(RAIL_ROW, ROW_IDLE) : cn(ROW, ROW_IDLE), focusRing)}
    >
      <span aria-hidden="true" className="flex h-5 w-5 shrink-0 items-center justify-center">
        {children}
      </span>
      <span className={rail ? 'sr-only' : 'truncate'}>{label}</span>
    </a>
  );
}

function IconButton({
  label,
  controls,
  onClick,
  children,
}: {
  label: string;
  controls?: string;
  onClick: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-controls={controls}
      title={label}
      className={cn('shrink-0 rounded-full p-2 text-fg-muted transition-colors duration-150 hover:bg-surface-hover hover:text-fg', focusRing)}
    >
      {children}
      <span className="sr-only">{label}</span>
    </button>
  );
}
