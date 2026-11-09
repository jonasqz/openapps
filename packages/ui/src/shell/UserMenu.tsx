import { useEffect, useId, useRef, useState } from 'react';
import type { JSX } from 'react';
import { cn } from '../lib/cn.ts';
import { focusRing } from '../lib/focus.ts';
import type { ShellUser } from './types.ts';
import { strings } from '../strings.ts';

export interface UserMenuProps {
  /** `null` = noch nicht geladen. Die Shell erfindet keinen Nutzer. */
  user: ShellUser | null;
  /** Fehlt der Nutzer dauerhaft, zeigt die Shell diesen Hinweis. */
  signedOutLabel?: string;
  onProfile?: () => void;
  onSignOut?: () => void;
  className?: string;
}

export function initialsOf(user: ShellUser): string {
  if (user.initials !== undefined && user.initials !== '') return user.initials.slice(0, 2).toUpperCase();
  const source = user.name ?? user.email;
  const parts = source.split(/[\s.@_-]+/).filter((part) => part.length > 0);
  const letters = parts.slice(0, 2).map((part) => part[0] ?? '');
  return (letters.join('') || source.slice(0, 2)).toUpperCase();
}

/**
 * Login-/Profilbereich.
 *
 * Die Shell weiß nicht, wie angemeldet wird — sie zeigt nur, wer da ist, und
 * ruft `onSignOut`/`onProfile` auf. Solange `user` `null` ist, steht hier ein
 * Platzhalter, kein Login-Formular.
 */
export function UserMenu({
  user,
  signedOutLabel,
  onProfile,
  onSignOut,
  className,
}: UserMenuProps): JSX.Element {
  const baseId = useId().replace(/:/g, '');
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocumentClick = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) === true || buttonRef.current?.contains(target) === true) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDocumentClick);
    document.addEventListener('keydown', onKeyDown);
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDocumentClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (user === null) {
    return (
      <span
        className={cn('flex items-center gap-2 px-2 text-sm text-fg-muted', className)}
        aria-live="polite"
      >
        <span
          aria-hidden="true"
          className="h-8 w-8 shrink-0 animate-oa-fade-in rounded-full bg-surface-muted"
        />
        <span className="hidden truncate sm:inline">{signedOutLabel ?? strings.userMenu.signedOut}</span>
      </span>
    );
  }

  const displayName = user.name ?? user.email;

  return (
    <div className={cn('relative', className)}>
      <button
        ref={buttonRef}
        type="button"
        id={`${baseId}-button`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'flex max-w-field items-center gap-2 rounded-full p-1 pr-2 hover:bg-surface-hover',
          focusRing,
        )}
      >
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-xs font-semibold text-primary-subtle-fg"
        >
          {initialsOf(user)}
        </span>
        <span className="hidden min-w-0 truncate text-sm text-fg sm:inline">{displayName}</span>
        <span className="sr-only">{strings.userMenu.label(displayName)}</span>
      </button>

      {open ? (
        <div
          ref={menuRef}
          role="menu"
          aria-labelledby={`${baseId}-button`}
          className="absolute right-0 top-full z-dropdown mt-1 w-panel max-w-[calc(100vw-2rem)] animate-oa-fade-in rounded-lg border border-border bg-bg p-1 shadow-lg"
        >
          <div className="border-b border-border px-3 py-2">
            <p className="truncate text-sm font-medium text-fg">{displayName}</p>
            <p className="truncate text-xs text-fg-muted">{user.email}</p>
            {user.groups !== undefined && user.groups.length > 0 ? (
              <p className="mt-1 truncate text-xs text-fg-subtle">{user.groups.join(', ')}</p>
            ) : null}
          </div>
          {onProfile === undefined ? null : (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onProfile();
              }}
              className={cn('block w-full rounded-md px-3 py-2 text-left text-sm text-fg hover:bg-surface-hover', focusRing)}
            >
              {strings.userMenu.profile}
            </button>
          )}
          {onSignOut === undefined ? null : (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onSignOut();
              }}
              className={cn('block w-full rounded-md px-3 py-2 text-left text-sm text-danger hover:bg-surface-hover', focusRing)}
            >
              {strings.userMenu.signOut}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
