'use client';

import { PlatformShell, type ShellNavGroup, type ShellPlatform, type ShellUser } from '@openapps/ui';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useMemo, type JSX, type ReactNode } from 'react';

/**
 * Die Bereiche dieser App in der gemeinsamen Leiste (ADR 0017). Nutzer,
 * App-Liste, „New app“, Settings und Abmelden liefert die Plattform.
 *
 * `path` ist der Pfad innerhalb der App (ohne basePath), `match` die Pfade,
 * unter denen der Eintrag als aktuelle Seite gilt. `/` gilt nur exakt, alles
 * andere auch fuer Unterseiten.
 */
const SECTIONS = [
  { id: 'tasks', label: 'All tasks', path: '/', match: ['/'] },
  { id: 'new', label: 'New task', path: '/new', match: ['/new'] },
] as const;

function matches(pathname: string, prefix: string): boolean {
  if (prefix === '/') return pathname === '/';
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Pfad in der App -> absolute Adresse mit basePath, z. B. `/tasks/new`. */
function withBase(basePath: string, path: string): string {
  if (path === '/') return basePath === '' ? '/' : basePath;
  return `${basePath}${path}`;
}

/** Umkehrung fuer den Client-Router: der rechnet den basePath selbst ein. */
function withoutBase(basePath: string, href: string): string {
  if (basePath === '') return href;
  if (href === basePath) return '/';
  return href.startsWith(`${basePath}/`) ? href.slice(basePath.length) : href;
}

export function Shell({
  appName,
  appTitle,
  platform,
  user,
  basePath,
  children,
}: {
  appName: string;
  appTitle: string;
  platform: ShellPlatform | null;
  user: ShellUser | null;
  /** Aus `OPENAPPS_APP_BASE_PATH`, leer bei lokalem `pnpm dev`. */
  basePath: string;
  children: ReactNode;
}): JSX.Element {
  // Ohne basePath: Next rechnet ihn aus usePathname heraus.
  const pathname = usePathname();
  const router = useRouter();

  const sections = useMemo<ShellNavGroup[]>(() => {
    const current = SECTIONS.find((section) => section.match.some((prefix) => matches(pathname, prefix)));
    return [
      {
        items: SECTIONS.map((section) => ({
          id: section.id,
          label: section.label,
          href: withBase(basePath, section.path),
          current: section.id === current?.id,
        })),
      },
    ];
  }, [pathname, basePath]);

  const onNavigate = useCallback(
    (href: string) => router.push(withoutBase(basePath, href)),
    [router, basePath],
  );

  return (
    <PlatformShell
      platform={platform}
      appName={appName}
      appTitle={appTitle}
      sections={sections}
      user={user}
      onNavigate={onNavigate}
    >
      {children}
    </PlatformShell>
  );
}
