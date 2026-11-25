import { getNavigation, getUser } from '@openapps/sdk';
import type { ShellPlatform, ShellUser } from '@openapps/ui';
import { headers } from 'next/headers';
import manifest from '../../app.json';

/**
 * Was die gemeinsame Leiste vom Server braucht (ADR 0017). Nur im Server
 * aufrufen: `getUser` und `getNavigation` pruefen die Signaturen des Gateways
 * mit dem Secret der App, das nie in den Browser darf.
 *
 * Diese Datei uebernimmst du unveraendert; deine Seiten traegst du in
 * `src/components/Shell.tsx` ein.
 *
 * Wirft nie. Die Leiste ist Anzeige, keine Freigabe — ob die Person die Seite
 * sehen darf, hat die Forward-Auth schon entschieden, und jede Aktion und
 * jeder Route-Handler prueft `getUser` selbst. Ohne gueltige Identitaet zeigt
 * die Leiste das Skelett, ohne Navigation nur diese App.
 */
export interface ShellData {
  /**
   * Name und Anzeigename aus `app.json`. Ueber den Namen findet die Leiste
   * diese App in der Liste der Plattform.
   */
  appName: string;
  appTitle: string;
  platform: ShellPlatform | null;
  user: ShellUser | null;
  basePath: string;
}

export async function loadShell(): Promise<ShellData> {
  const requestHeaders = await headers();

  let user: ShellUser | null = null;
  try {
    const platformUser = getUser(requestHeaders);
    user = { id: platformUser.id, email: platformUser.email, groups: [...platformUser.groups] };
  } catch {
    user = null;
  }

  // getNavigation wirft nie, `null` heisst: nur die eigene App zeigen.
  const nav = getNavigation(requestHeaders);
  const platform: ShellPlatform | null =
    nav === null
      ? null
      : {
          platformUrl: nav.platformUrl,
          apps: nav.apps.map((app) => ({
            name: app.name,
            title: app.title,
            category: app.category ?? null,
            href: app.href,
          })),
          canCreateApps: nav.canCreateApps,
          isAdmin: nav.isAdmin,
        };

  return {
    appName: manifest.name,
    appTitle: manifest.displayName,
    platform,
    user,
    basePath: appBasePath(),
  };
}

/**
 * Derselbe Pfad, den `next.config.js` als `basePath` in den Build backt. Die
 * Control Plane setzt `OPENAPPS_APP_BASE_PATH` fuer Build und Laufzeit
 * gleich. Ein unbrauchbarer Wert faellt hier auf `''` zurueck, statt die Seite
 * zu kosten — den Build haette er ohnehin schon abgebrochen.
 */
function appBasePath(): string {
  const raw = (process.env.OPENAPPS_APP_BASE_PATH ?? '').trim().replace(/\/+$/, '');
  return /^\/[a-z0-9][a-z0-9-]*$/.test(raw) ? raw : '';
}
