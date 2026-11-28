import Link from 'next/link';
import type { JSX, ReactNode } from 'react';
import { buttonClasses, cn, textLinkClasses } from '@openapps/ui';

/**
 * Verweise innerhalb der App. Immer `next/link`: Der rechnet den basePath
 * (/tasks) ein, ein rohes `<a href="/...">` landet auf der Plattform.
 */

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
    <Link href={href} className={cn(textLinkClasses, className)}>
      {children}
    </Link>
  );
}

/** Ein Verweis, der wie ein `Button` aus @openapps/ui aussieht (dieselben Klassen). */
export function ButtonLink({
  href,
  children,
  variant = 'primary',
}: {
  href: string;
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost';
}): JSX.Element {
  return (
    <Link href={href} className={buttonClasses({ variant })}>
      {children}
    </Link>
  );
}
