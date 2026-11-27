/**
 * Die eigenen Bereiche einer App in der gemeinsamen Leiste (ADR 0017,
 * ADR 0019): aus einer festen Tabelle und dem aktuellen Pfad die Gruppen fuer
 * `PlatformShell`.
 *
 * Rein und ohne React, ohne Next: `NextPlatformShell` aus `@openapps/ui/next`
 * nutzt es mit `usePathname`, eine App mit anderem Router direkt.
 */
import type { ShellNavGroup } from './types.ts';

/**
 * Ein Bereich der App, z. B. `{ id: 'companies', label: 'Companies', path:
 * '/companies' }`. Nur einfache Werte: Die Tabelle steht im Layout (Server)
 * und geht als Prop an eine Client-Komponente.
 */
export interface AppSection {
  /** Stabil und eindeutig innerhalb der App. */
  readonly id: string;
  /** Sichtbarer Text, englisch (ADR 0016). */
  readonly label: string;
  /** Pfad innerhalb der App, **ohne** basePath: `/items`, nicht `/my-app/items`. */
  readonly path: string;
  /**
   * Pfade, unter denen der Eintrag als aktuelle Seite gilt. Default: `[path]`.
   * `/` gilt nur exakt, alles andere auch fuer Unterseiten (`/items/42`).
   */
  readonly match?: readonly string[];
}

/** Gilt `pathname` als `prefix`? `/` nur exakt, sonst auch Unterseiten. */
export function sectionMatches(pathname: string, prefix: string): boolean {
  if (prefix === '/') return pathname === '/';
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Pfad in der App -> absolute Adresse mit basePath, z. B. `/crm/companies`. */
export function withBasePath(basePath: string, path: string): string {
  if (path === '/') return basePath === '' ? '/' : basePath;
  return `${basePath}${path}`;
}

/**
 * Umkehrung fuer den Client-Router, der den basePath selbst davor setzt.
 * Adressen ausserhalb der App bleiben unveraendert.
 */
export function withoutBasePath(basePath: string, href: string): string {
  if (basePath === '') return href;
  if (href === basePath) return '/';
  return href.startsWith(`${basePath}/`) ? href.slice(basePath.length) : href;
}

/**
 * Die Gruppen fuer `PlatformShell.sections`. `pathname` ist der Pfad ohne
 * basePath (so liefert ihn `usePathname` in Next). Hoechstens ein Eintrag ist
 * aktuell: der erste, dessen `match` passt.
 */
export function sectionNav(
  sections: readonly AppSection[],
  pathname: string,
  basePath: string,
): ShellNavGroup[] {
  const current = sections.find((section) =>
    (section.match ?? [section.path]).some((prefix) => sectionMatches(pathname, prefix)),
  );
  return [
    {
      items: sections.map((section) => ({
        id: section.id,
        label: section.label,
        href: withBasePath(basePath, section.path),
        current: section.id === current?.id,
      })),
    },
  ];
}
