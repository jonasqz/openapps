import Link from 'next/link';
import type { JSX, ReactNode } from 'react';
import { cn, focusRing } from '@openapps/ui';

/**
 * Ein Verweis, der aussieht wie `Button`. `Button` aus `@openapps/ui` ist ein
 * `<button>` — fuer einen Seitenwechsel ist ein echter Link richtig (Mittelklick,
 * neuer Tab, Screenreader sagt „Link“). `next/link` rechnet den `basePath`
 * ein; ein selbst geschriebenes `<a href="/...">` wuerde auf die Plattform
 * zeigen statt auf die App.
 *
 * Nur Tokens aus dem Design System, dieselben Klassen wie `Button`.
 */
const VARIANT = {
  primary: 'bg-primary text-primary-fg hover:bg-primary-hover',
  secondary: 'bg-surface text-fg border border-border-strong hover:bg-surface-hover',
  ghost: 'bg-transparent text-fg hover:bg-surface-hover',
} as const;

export interface LinkButtonProps {
  href: string;
  children: ReactNode;
  variant?: keyof typeof VARIANT;
  size?: 'sm' | 'md';
}

export function LinkButton({
  href,
  children,
  variant = 'secondary',
  size = 'md',
}: LinkButtonProps): JSX.Element {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex min-w-0 items-center justify-center rounded-md font-medium transition-colors',
        size === 'sm' ? 'min-h-8 gap-1.5 px-3 py-1 text-sm' : 'min-h-10 gap-2 px-4 py-2 text-sm',
        focusRing,
        VARIANT[variant],
      )}
    >
      {children}
    </Link>
  );
}

/** Ein Textverweis innerhalb der App, mit sichtbarem Fokus. */
export function TextLink({ href, children }: { href: string; children: ReactNode }): JSX.Element {
  return (
    <Link
      href={href}
      className={cn(
        'rounded-sm font-medium text-primary underline-offset-2 hover:underline',
        focusRing,
      )}
    >
      {children}
    </Link>
  );
}
