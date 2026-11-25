'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { JSX, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { cn } from '../lib/cn.ts';
import { focusRing, focusRingInset } from '../lib/focus.ts';
import { strings } from '../strings.ts';
import { BookIcon, ChevronsIcon, MoonIcon, SettingsIcon, SignOutIcon, SunIcon, SystemIcon } from './icons.tsx';
import type { ShellTheme, ShellUser } from './types.ts';
import { initialsOf } from './UserMenu.tsx';

export interface SidebarUserMenuProps {
  user: ShellUser | null;
  /** Schmale Leiste: nur der Avatar, das Menue klappt nach rechts auf. */
  rail: boolean;
  theme: ShellTheme;
  onThemeChange: (theme: ShellTheme) => void;
  /** Adressen der Plattform. `null` blendet den Eintrag aus. */
  settingsHref: string | null;
  getStartedHref: string | null;
  signOutHref: string | null;
}

const ITEM = 'flex w-full min-w-0 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm text-fg hover:bg-surface-hover';

/**
 * Nutzerkarte unten in der Leiste mit Menue nach oben.
 *
 * Tastatur: Enter/Space/Pfeiltasten oeffnen, Pfeiltasten wandern durch alle
 * Eintraege (auch die drei Darstellungen), Home/End springen, Escape schliesst
 * und gibt den Fokus an die Karte zurueck, Tab schliesst.
 */
export function SidebarUserMenu({
  user,
  rail,
  theme,
  onThemeChange,
  settingsHref,
  getStartedHref,
  signOutHref,
}: SidebarUserMenuProps): JSX.Element {
  const baseId = useId().replace(/:/g, '');
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocumentDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) === true || buttonRef.current?.contains(target) === true) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocumentDown);
    menuRef.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus({ preventScroll: true });
    return () => document.removeEventListener('mousedown', onDocumentDown);
  }, [open]);

  if (user === null) {
    // Laedt: Skelett in der Form der Karte, damit nichts springt.
    return (
      <div
        role="status"
        aria-busy="true"
        className={cn('flex min-w-0 items-center gap-2.5 py-1.5', rail ? 'justify-center' : 'px-2')}
      >
        <span aria-hidden="true" className="h-6 w-6 shrink-0 animate-pulse rounded-full bg-surface-muted" />
        {rail ? null : (
          <span aria-hidden="true" className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="h-2.5 w-20 animate-pulse rounded-sm bg-surface-muted" />
            <span className="h-2 w-16 animate-pulse rounded-sm bg-surface-muted" />
          </span>
        )}
        <span className="sr-only">{strings.platformShell.loadingUser}</span>
      </div>
    );
  }

  const displayName = user.name ?? user.email;
  const close = (focusButton: boolean): void => {
    setOpen(false);
    if (focusButton) buttonRef.current?.focus({ preventScroll: true });
  };

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);
    const index = items.findIndex((item) => item === document.activeElement);
    const go = (next: number): void => {
      event.preventDefault();
      items[(next + items.length) % items.length]?.focus({ preventScroll: true });
    };
    if (event.key === 'ArrowDown') go(index + 1);
    else if (event.key === 'ArrowUp') go(index - 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(items.length - 1);
    else if (event.key === 'Escape') {
      // Nicht bis zur Schublade durchreichen: Escape schliesst erst das Menue.
      event.stopPropagation();
      event.preventDefault();
      close(true);
    } else if (event.key === 'Tab') setOpen(false);
  };

  const themes: ReadonlyArray<[ShellTheme, string, ReactNode]> = [
    ['system', strings.platformShell.themeSystem, <SystemIcon key="system" />],
    ['light', strings.platformShell.themeLight, <SunIcon key="light" />],
    ['dark', strings.platformShell.themeDark, <MoonIcon key="dark" />],
  ];

  return (
    <div className="relative min-w-0">
      <button
        ref={buttonRef}
        type="button"
        id={`${baseId}-button`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${baseId}-menu` : undefined}
        aria-label={strings.platformShell.userMenuLabel(displayName)}
        title={rail ? displayName : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          'flex w-full min-w-0 items-center gap-2.5 rounded-lg py-1.5 text-left',
          'transition-colors duration-150 hover:bg-surface-muted',
          open && 'bg-surface-muted',
          rail ? 'justify-center' : 'px-2',
          focusRing,
        )}
      >
        <span
          aria-hidden="true"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-subtle font-mono text-2xs font-medium text-primary-subtle-fg"
        >
          {initialsOf(user)}
        </span>
        {rail ? null : (
          <>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium text-fg">{displayName}</span>
              {user.name === undefined ? null : <span className="truncate text-xs text-fg-muted">{user.email}</span>}
            </span>
            <span aria-hidden="true" className="shrink-0 text-fg-muted">
              <ChevronsIcon />
            </span>
          </>
        )}
      </button>

      {open ? (
        <div
          ref={menuRef}
          role="menu"
          id={`${baseId}-menu`}
          aria-labelledby={`${baseId}-button`}
          onKeyDown={onMenuKeyDown}
          className={cn(
            'absolute bottom-full left-0 z-dropdown mb-2 max-w-[calc(100vw-2rem)] animate-oa-slide-in',
            'rounded-xl border border-border bg-bg p-1 shadow-lg',
            rail ? 'w-menu' : 'right-0',
          )}
        >
          <div className="min-w-0 px-2.5 pb-2 pt-1.5">
            <p className="truncate text-sm font-medium text-fg">{displayName}</p>
            <p className="truncate text-xs text-fg-muted">{user.email}</p>
          </div>
          {settingsHref === null && getStartedHref === null ? null : (
            <div role="none" className="border-t border-border pt-1">
              {settingsHref === null ? null : (
                <a role="menuitem" href={settingsHref} className={cn(ITEM, focusRingInset)}>
                  <span className="text-fg-muted">
                    <SettingsIcon />
                  </span>
                  <span className="truncate">{strings.platformShell.settings}</span>
                </a>
              )}
              {getStartedHref === null ? null : (
                <a role="menuitem" href={getStartedHref} className={cn(ITEM, focusRingInset)}>
                  <span className="text-fg-muted">
                    <BookIcon />
                  </span>
                  <span className="truncate">{strings.platformShell.getStarted}</span>
                </a>
              )}
            </div>
          )}
          <div role="group" aria-label={strings.platformShell.theme} className="mt-1 border-t border-border px-1 pb-1 pt-2">
            <p aria-hidden="true" className="px-1.5 pb-1.5 font-mono text-2xs font-medium uppercase tracking-label text-fg-muted">
              {strings.platformShell.theme}
            </p>
            <div className="grid grid-cols-3 gap-0.5 rounded-lg bg-surface-muted p-0.5">
              {themes.map(([value, label, icon]) => (
                <button
                  key={value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={theme === value}
                  onClick={() => onThemeChange(value)}
                  className={cn(
                    'flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-md px-1 py-1.5 text-2xs',
                    'transition-colors duration-150',
                    theme === value
                      ? 'bg-bg font-medium text-fg shadow-sm'
                      : 'text-fg-muted hover:text-fg',
                    focusRingInset,
                  )}
                >
                  {icon}
                  <span className="truncate">{label}</span>
                </button>
              ))}
            </div>
          </div>
          {signOutHref === null ? null : (
            <div role="none" className="mt-1 border-t border-border pt-1">
              <a role="menuitem" href={signOutHref} className={cn(ITEM, focusRingInset)}>
                <span className="text-fg-muted">
                  <SignOutIcon />
                </span>
                <span className="truncate">{strings.platformShell.signOut}</span>
              </a>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
