'use client';

import { PlatformShell, type ShellPlatform, type ShellUser } from '@openapps/ui';
import { usePathname } from 'next/navigation';
import type { JSX, ReactNode } from 'react';

const NAV = [
  { id: 'apps', label: 'Apps', href: '/' },
  { id: 'agents', label: 'Agents', href: '/agents' },
  { id: 'grants', label: 'Grants', href: '/grants' },
  { id: 'get-started', label: 'Get started', href: '/get-started' },
  { id: 'settings', label: 'Settings', href: '/settings' },
] as const;

function isCurrent(href: string, pathname: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

/** Die Verwaltung in derselben Leiste wie jede App (ADR 0017). */
export function VerwaltungShell({
  user,
  platform,
  children,
}: {
  user: ShellUser;
  platform: ShellPlatform | null;
  children: ReactNode;
}): JSX.Element {
  const pathname = usePathname();
  return (
    <PlatformShell
      platform={platform}
      appName="admin"
      appTitle="Admin"
      user={user}
      sections={[
        { items: NAV.map((item) => ({ ...item, current: isCurrent(item.href, pathname) })) },
      ]}
    >
      {children}
    </PlatformShell>
  );
}
