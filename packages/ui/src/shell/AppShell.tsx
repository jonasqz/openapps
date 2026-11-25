'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import { cn } from '../lib/cn.ts';
import { focusRing } from '../lib/focus.ts';
import { trapFocus } from '../lib/focus.ts';
import { ToastProvider } from '../components/Toast.tsx';
import { AppSwitcher } from './AppSwitcher.tsx';
import { NotificationBell } from './NotificationBell.tsx';
import { UserMenu } from './UserMenu.tsx';
import { CommandPalette } from './CommandPalette.tsx';
import type { CommandItem } from './CommandPalette.tsx';
import { Icon } from '../components/Icon.tsx';
import { Kbd } from '../components/Kbd.tsx';
import type { ShellApp, ShellNavGroup, ShellNotification, ShellUser } from './types.ts';
import { strings } from '../strings.ts';

export interface AppShellProps {
  /** Name der Plattform links oben. */
  productName?: string;
  /** Name der aktuellen App — steht im Seitentitel-Bereich. */
  appName: string;
  /** Apps für den Wechsler. Leer heißt: nur diese App ist freigegeben. */
  apps?: readonly ShellApp[];
  /** Navigation der App. Die Shell rendert sie, die App füllt sie. */
  nav?: readonly ShellNavGroup[];
  /**
   * Der angemeldete Nutzer, aus `@openapps/sdk`. Die Shell baut keinen Login.
   * `null` = noch nicht geladen.
   */
  user: ShellUser | null;
  notifications?: readonly ShellNotification[];
  notificationsLoading?: boolean;
  notificationsError?: string;
  onNotificationOpen?: (notification: ShellNotification) => void;
  onMarkAllNotificationsRead?: () => void;
  onNavigate?: (href: string) => void;
  onProfile?: () => void;
  onSignOut?: () => void;
  /**
   * Befehlspalette (⌘K / Strg+K) mit allen Navigationseinträgen und Apps.
   * Vorgabe: an, sobald es Navigation oder Apps gibt.
   */
  commandPalette?: boolean;
  /** Der Inhalt der App. Nur das baut ein App-Agent. */
  children: ReactNode;
  className?: string;
}

/**
 * Die Hülle, die die Plattform liefert: Kopfzeile mit App-Wechsler,
 * Benachrichtigungen und Profil, links die Navigation, in der Mitte der
 * Inhalt der App.
 *
 * Fokus-Reihenfolge, von oben:
 *   1. „Zum Inhalt springen“ (sichtbar, sobald er den Fokus hat)
 *   2. Menü-Knopf (nur unter `md`)
 *   3. App-Wechsler
 *   4. Benachrichtigungen
 *   5. Profil
 *   6. Navigation
 *   7. Inhalt
 *
 * Phone-Breite: die Navigation wird zu einer Schublade über
 * `aria-modal`-Dialog mit Fokusfalle; nichts scrollt waagerecht, weil der
 * Inhalt `min-w-0` ist und die Kopfzeile nur abschneidet, nie überläuft.
 */
export function AppShell({
  productName,
  appName,
  apps = [],
  nav = [],
  user,
  notifications = [],
  notificationsLoading = false,
  notificationsError,
  onNotificationOpen,
  onMarkAllNotificationsRead,
  onNavigate,
  onProfile,
  onSignOut,
  commandPalette = true,
  children,
  className,
}: AppShellProps): JSX.Element {
  const baseId = useId().replace(/:/g, '');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const hasNav = nav.some((group) => group.items.length > 0);
  const product = productName ?? strings.shell.productName;
  const [paletteOpen, setPaletteOpen] = useState(false);
  const commands: CommandItem[] = [
    ...nav.flatMap((group) =>
      group.items.map((item) => ({
        id: `nav-${item.id}`,
        label: item.label,
        href: item.href,
        group: group.title ?? strings.commandPalette.navigationGroup,
        hint: item.href,
        ...(item.icon === undefined ? {} : { icon: item.icon }),
      })),
    ),
    ...apps.map((app) => ({
      id: `app-${app.id}`,
      label: app.name,
      href: app.href,
      group: strings.commandPalette.appsGroup,
      hint: app.href,
    })),
  ];
  const paletteEnabled = commandPalette && commands.length > 0;

  useEffect(() => {
    if (!paletteEnabled) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setDrawerOpen(false);
        setPaletteOpen((value) => !value);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [paletteEnabled]);

  const searchTrigger = paletteEnabled ? (
    <button
      type="button"
      onClick={() => {
        setDrawerOpen(false);
        setPaletteOpen(true);
      }}
      aria-haspopup="dialog"
      aria-keyshortcuts="Meta+K Control+K"
      className={cn(
        'mb-5 flex w-full min-w-0 items-center gap-2 rounded-md border border-border bg-bg px-3 py-2 text-left text-sm text-fg-subtle',
        'transition-colors duration-150 hover:border-border-strong hover:text-fg-muted',
        focusRing,
      )}
    >
      <Icon name="search" />
      <span className="min-w-0 flex-1 truncate">{strings.commandPalette.trigger}</span>
      <Kbd aria-hidden="true">⌘K</Kbd>
    </button>
  ) : null;

  useEffect(() => {
    if (!drawerOpen) return undefined;
    const panel = drawerRef.current;
    if (panel === null) return undefined;
    const untrap = trapFocus(panel);
    panel.querySelector<HTMLElement>('a,button')?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      untrap();
      document.removeEventListener('keydown', onKeyDown);
      menuButtonRef.current?.focus();
    };
  }, [drawerOpen]);

  const navList = (
    <nav aria-label={strings.shell.navigationLabel(appName)} className="flex min-w-0 flex-col gap-4">
      {nav.map((group, groupIndex) => (
        <div key={group.title ?? `oa-nav-${groupIndex}`} className="min-w-0">
          {group.title === undefined ? null : (
            <p className="px-3 pb-2 font-mono text-2xs font-medium uppercase tracking-label text-fg-muted">
              {group.title}
            </p>
          )}
          <ul className="flex min-w-0 flex-col gap-0.5">
            {group.items.map((item) => (
              <li key={item.id} className="min-w-0">
                <a
                  href={item.href}
                  aria-current={item.current === true ? 'page' : undefined}
                  onClick={(event) => {
                    if (onNavigate !== undefined) {
                      event.preventDefault();
                      onNavigate(item.href);
                    }
                    setDrawerOpen(false);
                  }}
                  className={cn(
                    'flex min-w-0 items-center gap-2.5 rounded-sm px-3 py-2 text-sm transition-colors duration-150',
                    focusRing,
                    item.current === true
                      ? "relative bg-surface-hover font-medium text-fg before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:bg-primary before:content-['']"
                      : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
                  )}
                >
                  {item.icon === undefined ? null : (
                    <span
                      aria-hidden="true"
                      className={cn('shrink-0', item.current === true ? 'text-fg' : 'text-fg-subtle')}
                    >
                      {item.icon}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.badge === undefined ? null : (
                    <span className="shrink-0 font-mono text-2xs tabular-nums text-fg-subtle">
                      {item.badge > 99 ? '99+' : item.badge}
                    </span>
                  )}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <ToastProvider>
      <div className={cn('flex min-h-screen min-w-0 flex-col bg-bg text-fg', className)}>
        <a
          href={`#${baseId}-main`}
          onClick={(event) => {
            event.preventDefault();
            document.getElementById(`${baseId}-main`)?.focus();
          }}
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-toast focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-fg"
        >
          {strings.shell.skipToContent}
        </a>

        <header className="sticky top-0 z-shell flex min-h-14 min-w-0 items-center gap-2 border-b border-border bg-bg px-3 py-2 sm:px-4">
          {hasNav ? (
            <button
              ref={menuButtonRef}
              type="button"
              aria-expanded={drawerOpen}
              aria-controls={`${baseId}-drawer`}
              onClick={() => setDrawerOpen(true)}
              className={cn('rounded-full p-2 text-fg-muted hover:bg-surface-hover hover:text-fg md:hidden', focusRing)}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <path d="M3 6h14M3 10h14M3 14h14" />
              </svg>
              <span className="sr-only">{strings.shell.openNavigation}</span>
            </button>
          ) : null}

          <span className="hidden shrink-0 font-mono text-xs font-medium uppercase tracking-loose text-fg sm:inline">{product}</span>
          <span aria-hidden="true" className="hidden shrink-0 text-fg-subtle sm:inline">
            /
          </span>

          <AppSwitcher apps={apps} currentName={appName} className="min-w-0 flex-1 sm:flex-none sm:max-w-xs" {...(onNavigate === undefined ? {} : { onNavigate: (app: ShellApp) => onNavigate(app.href) })} />

          <div className="ml-auto flex shrink-0 items-center gap-1">
            <NotificationBell
              notifications={notifications}
              loading={notificationsLoading}
              {...(notificationsError === undefined ? {} : { error: notificationsError })}
              {...(onNotificationOpen === undefined ? {} : { onOpen: onNotificationOpen })}
              {...(onMarkAllNotificationsRead === undefined ? {} : { onMarkAllRead: onMarkAllNotificationsRead })}
            />
            <UserMenu
              user={user}
              {...(onProfile === undefined ? {} : { onProfile })}
              {...(onSignOut === undefined ? {} : { onSignOut })}
            />
          </div>
        </header>

        <div className="flex min-w-0 flex-1">
          {hasNav ? (
            <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-nav min-w-0 shrink-0 overflow-y-auto border-r border-border bg-bg px-3 py-5 md:block">
              {searchTrigger}
              {navList}
            </aside>
          ) : null}

          <main
            id={`${baseId}-main`}
            tabIndex={-1}
            className="min-w-0 flex-1 p-4 outline-none sm:p-8 lg:p-10"
          >
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
              aria-label={strings.shell.navigationLabel(appName)}
              className="relative flex h-full w-drawer max-w-[85vw] animate-oa-slide-in flex-col gap-4 border-r border-border bg-bg p-3"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-medium uppercase tracking-loose text-fg">{product}</span>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  className={cn('rounded-full px-2 py-1 text-fg-muted hover:bg-surface-hover hover:text-fg', focusRing)}
                >
                  <span aria-hidden="true">✕</span>
                  <span className="sr-only">{strings.shell.closeNavigation}</span>
                </button>
              </div>
              <div className="min-w-0 overflow-y-auto">
                {searchTrigger}
                {navList}
              </div>
            </div>
          </div>
        ) : null}

        {paletteEnabled ? (
          <CommandPalette
            open={paletteOpen}
            onClose={() => setPaletteOpen(false)}
            items={commands}
            onSelect={(item) => {
              if (onNavigate !== undefined) onNavigate(item.href);
              else window.location.assign(item.href);
            }}
          />
        ) : null}
      </div>
    </ToastProvider>
  );
}
