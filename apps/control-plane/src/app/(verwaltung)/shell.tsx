'use client';

import {
  createPlatformSearch,
  PlatformShell,
  type ShellPlatform,
  type ShellUser,
} from '@openapps/ui';
import { usePathname } from 'next/navigation';
import { useMemo, type JSX, type ReactNode } from 'react';

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
  // Die Suche ueber alle Apps (ADR 0021): auf dem eigenen Host unter
  // `/_platform/search`, umgeschrieben auf `/api/search` (next.config.mjs).
  const hasPlatform = platform !== null;
  const search = useMemo(() => (hasPlatform ? createPlatformSearch() : undefined), [hasPlatform]);
  return (
    <PlatformShell
      platform={platform}
      appName="admin"
      appTitle="Admin"
      user={user}
      {...(search === undefined ? {} : { search })}
      sections={[
        { items: NAV.map((item) => ({ ...item, current: isCurrent(item.href, pathname) })) },
      ]}
    >
      {children}
    </PlatformShell>
  );
}
