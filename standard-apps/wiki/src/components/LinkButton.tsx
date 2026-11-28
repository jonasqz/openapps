import Link from 'next/link';
import type { JSX, ReactNode } from 'react';
import { buttonClasses, textLinkClasses } from '@openapps/ui';

/**
 * Ein Verweis, der aussieht wie `Button`. `Button` aus `@openapps/ui` ist ein
 * `<button>` — fuer einen Seitenwechsel ist ein echter Link richtig (Mittelklick,
 * neuer Tab, Screenreader sagt „Link“). `next/link` rechnet den `basePath`
 * ein; ein selbst geschriebenes `<a href="/...">` wuerde auf die Plattform
 * zeigen statt auf die App.
 *
 * Nur Tokens aus dem Design System, dieselben Klassen wie `Button`.
 */
export interface LinkButtonProps {
  href: string;
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md';
}

export function LinkButton({
  href,
  children,
  variant = 'secondary',
  size = 'md',
}: LinkButtonProps): JSX.Element {
  return (
    <Link href={href} className={buttonClasses({ variant, size })}>
      {children}
    </Link>
  );
}

/** Ein Textverweis innerhalb der App, mit sichtbarem Fokus. */
export function TextLink({ href, children }: { href: string; children: ReactNode }): JSX.Element {
  return (
    <Link href={href} className={textLinkClasses}>
      {children}
    </Link>
  );
}
