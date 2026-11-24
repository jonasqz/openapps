import Link from 'next/link';
import type { JSX, ReactNode } from 'react';
import { cn, focusRing } from '@openapps/ui';

/**
 * Ein Verweis innerhalb der App. `next/link` rechnet den `basePath` ein — ein
 * rohes `<a href="/dokumente">` zeigte auf die Plattform statt auf die App.
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
    <Link
      href={href}
      className={cn(
        'rounded-sm font-medium text-primary underline-offset-2 hover:underline',
        focusRing,
        className,
      )}
    >
      {children}
    </Link>
  );
}
