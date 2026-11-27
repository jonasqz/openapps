'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useMemo, type JSX, type ReactNode } from 'react';
import { PlatformShell } from '../shell/PlatformShell.tsx';
import { createPlatformSearch, type PlatformSearch } from '../shell/platform-search.ts';
import { sectionNav, withoutBasePath, type AppSection } from '../shell/sections.ts';
import type { ShellPlatform, ShellUser } from '../shell/types.ts';

export interface NextPlatformShellProps {
  /** Technischer Name aus `app.json`, wie in `platform.apps[].name`. */
  appName: string;
  /** Anzeigename aus `app.json`. */
  appTitle: string;
  /** Aus `loadShell()` (`@openapps/sdk/next`). `null`: nur diese App. */
  platform: ShellPlatform | null;
  /** Aus `loadShell()`. `null`: Skelett. */
  user: ShellUser | null;
  /** Aus `OPENAPPS_APP_BASE_PATH`, leer bei lokalem `pnpm dev`. */
  basePath: string;
  /** Die eigenen Bereiche der App. Die einzige Angabe, die die App selbst macht. */
  sections: readonly AppSection[];
  /**
   * Die Suche ueber alle Apps (ADR 0021). Ohne Angabe: `/_platform/search`
   * auf dem eigenen Origin, sobald die Plattform da ist (`platform !== null`,
   * also hinter dem Gateway). `null` schaltet sie ab.
   */
  search?: PlatformSearch | null;
  children: ReactNode;
}

/**
 * Die gemeinsame Leiste fuer eine Next-App (App Router), ADR 0019:
 * `PlatformShell` plus aktueller Pfad und Client-Router. Die App schreibt nur
 * ihre Bereiche und reicht `loadShell()` durch:
 *
 * ```tsx
 * <NextPlatformShell {...await loadShell(manifest)} sections={SECTIONS}>
 *   {children}
 * </NextPlatformShell>
 * ```
 *
 * Eigener Unterpfad `@openapps/ui/next`, damit der Kern des Design Systems
 * (Schaufenster, andere Frameworks) kein `next` braucht.
 */
export function NextPlatformShell({
  appName,
  appTitle,
  platform,
  user,
  basePath,
  sections,
  search,
  children,
}: NextPlatformShellProps): JSX.Element {
  // Ohne basePath: Next rechnet ihn aus usePathname heraus.
  const pathname = usePathname();
  const router = useRouter();

  const groups = useMemo(
    () => sectionNav(sections, pathname, basePath),
    [sections, pathname, basePath],
  );

  // Der Router setzt den basePath selbst davor, also hier ohne. Links zu
  // anderen Apps und zur Plattform laufen nicht ueber onNavigate.
  const onNavigate = useCallback(
    (href: string) => router.push(withoutBasePath(basePath, href)),
    [router, basePath],
  );

  // Ohne gueltige Navigation laeuft die App nicht hinter dem Gateway (etwa
  // `pnpm dev`); dann gibt es auch keinen Weg zur Suche. Stabil je Plattform,
  // damit die Palette nicht bei jedem Render neu sucht.
  const hasPlatform = platform !== null;
  const platformSearch = useMemo(
    () => (search === undefined ? (hasPlatform ? createPlatformSearch() : null) : search),
    [search, hasPlatform],
  );

  return (
    <PlatformShell
      platform={platform}
      appName={appName}
      appTitle={appTitle}
      sections={groups}
      user={user}
      onNavigate={onNavigate}
      {...(platformSearch === null ? {} : { search: platformSearch })}
    >
      {children}
    </PlatformShell>
  );
}
