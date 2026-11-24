'use client';

import { createContext, useContext } from 'react';
import type { ComponentType, JSX, ReactNode } from 'react';

/**
 * Verweise innerhalb einer App. Eine App laeuft unter ihrem Pfad (`/crm`,
 * ADR 0007), und ein rohes `<a href="/firmen">` landet auf der Plattform
 * statt in der App. Der Router der App kennt den Pfad, das Design System
 * nicht. Deshalb gibt die App ihren Link einmal an:
 *
 * ```tsx
 * 'use client';
 * import Link from 'next/link';
 * export const Links = ({ children }) => <LinkProvider component={Link}>{children}</LinkProvider>;
 * ```
 *
 * Ohne Provider bleibt es ein `<a>`: richtig fuer Anker und fuer Apps ohne Pfad.
 */
export type LinkComponent = ComponentType<{
  href: string;
  className?: string;
  children?: ReactNode;
}>;

const LinkContext = createContext<LinkComponent | null>(null);

export function LinkProvider({
  component,
  children,
}: {
  component: LinkComponent;
  children?: ReactNode;
}): JSX.Element {
  return <LinkContext.Provider value={component}>{children}</LinkContext.Provider>;
}

export function UiLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children?: ReactNode;
}): JSX.Element {
  const Component = useContext(LinkContext);
  if (Component === null) {
    return (
      <a href={href} className={className}>
        {children}
      </a>
    );
  }
  return (
    <Component href={href} {...(className === undefined ? {} : { className })}>
      {children}
    </Component>
  );
}
