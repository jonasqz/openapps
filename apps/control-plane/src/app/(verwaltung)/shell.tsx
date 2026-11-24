'use client';

import { AppShell, type ShellUser } from '@openapps/ui';
import { usePathname } from 'next/navigation';
import type { JSX, ReactNode } from 'react';

const NAV = [
  { id: 'apps', label: 'Apps', href: '/' },
  { id: 'agents', label: 'Agents', href: '/agents' },
  { id: 'grants', label: 'Freigaben', href: '/grants' },
] as const;

function isCurrent(href: string, pathname: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

export function VerwaltungShell({
  user,
  children,
}: {
  user: ShellUser;
  children: ReactNode;
}): JSX.Element {
  const pathname = usePathname();
  return (
    <AppShell
      productName="openapps"
      appName="Verwaltung"
      user={user}
      nav={[{ items: NAV.map((item) => ({ ...item, current: isCurrent(item.href, pathname) })) }]}
      onSignOut={() => {
        // Better Auth meldet ab und loescht die Session; danach zum Login.
        void fetch('/api/auth/sign-out', { method: 'POST' }).finally(() => {
          window.location.assign('/login');
        });
      }}
    >
      {children}
    </AppShell>
  );
}
