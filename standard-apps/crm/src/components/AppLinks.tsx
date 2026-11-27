'use client';

import Link from 'next/link';
import type { JSX, ReactNode } from 'react';
import { LinkProvider } from '@openapps/ui';

/**
 * Gibt Verweisen aus @openapps/ui (Pfad im `PageHeader`, `DetailPattern`)
 * `next/link` mit, damit sie den basePath (/crm) einrechnen. Ohne das waere
 * ein Pfad-Eintrag ein rohes `<a href="/deals">` und landete auf der Plattform.
 *
 * Gehoert eigentlich einmal ins Layout; das Layout zieht gerade ins SDK und
 * bleibt hier unberuehrt, deshalb umschliesst jede Seite mit Pfad sich selbst.
 */
function AppLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children?: ReactNode;
}): JSX.Element {
  return (
    <Link href={href} {...(className === undefined ? {} : { className })}>
      {children}
    </Link>
  );
}

export function AppLinks({ children }: { children: ReactNode }): JSX.Element {
  return <LinkProvider component={AppLink}>{children}</LinkProvider>;
}
