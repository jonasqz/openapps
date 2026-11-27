'use client';

import Link from 'next/link';
import type { JSX, ReactNode } from 'react';
import { LinkProvider, type LinkComponent } from '@openapps/ui';

/**
 * Damit Verweise aus @openapps/ui (etwa der Pfad im `PageHeader`) den
 * basePath kennen: Sie gehen dann durch `next/link` statt als rohes `<a>`.
 * Liegt um die Seiten, die solche Verweise zeigen; das Layout bleibt
 * unberuehrt.
 */
/** Duenne Huelle: `next/link` hat breitere Props (Url-Objekte), als LinkComponent verlangt. */
const NextLink: LinkComponent = ({ href, className, children }) => (
  <Link href={href} {...(className === undefined ? {} : { className })}>
    {children}
  </Link>
);

export function AppLinks({ children }: { children: ReactNode }): JSX.Element {
  return <LinkProvider component={NextLink}>{children}</LinkProvider>;
}
