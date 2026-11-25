import Link from 'next/link';
import type { JSX, ReactNode } from 'react';
import { cn } from '@openapps/ui';

/**
 * Verweise innerhalb der App. Immer `next/link`: Der rechnet den basePath
 * (/crm) ein, ein rohes `<a href="/...">` landet auf der Plattform.
 */

const TEXT_LINK =
  'rounded-sm font-medium text-primary underline-offset-2 hover:underline outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

export function TextLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <Link href={href} className={cn(TEXT_LINK, className)}>
      {children}
    </Link>
  );
}

const BUTTON_LINK = {
  primary: 'bg-primary text-primary-fg hover:bg-primary-hover',
  secondary: 'bg-surface text-fg border border-border-strong hover:bg-surface-hover',
} as const;

/** Ein Verweis, der wie ein `Button` aus @openapps/ui aussieht. */
export function ButtonLink({
  href,
  children,
  variant = 'primary',
}: {
  href: string;
  children: ReactNode;
  variant?: keyof typeof BUTTON_LINK;
}): JSX.Element {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        BUTTON_LINK[variant],
      )}
    >
      {children}
    </Link>
  );
}
