import { getUser, type GetUserOptions } from './gateway.js';
import type { HeaderBag } from './headers.js';
import { getNavigation } from './nav.js';

/**
 * Was die gemeinsame Leiste vom Server braucht (ADR 0017, ADR 0019): die
 * angemeldete Person, die Navigation der Plattform, Name und Titel der App
 * und ihr basePath.
 *
 * Bewusst ohne Next.js und ohne React: Dieser Kern liest nur Header und Env.
 * `loadShell()` aus `@openapps/sdk/next` liest die Header der laufenden
 * Anfrage und ruft `readShell` auf; eine App mit anderem Framework ruft
 * `readShell` direkt.
 *
 * Die Typen sind strukturell gleich zu `ShellUser` und `ShellPlatform` aus
 * `@openapps/ui`, ohne sie zu importieren: Das SDK haengt nicht vom Design
 * System ab und umgekehrt.
 */

/** Variable, die `next.config.js` als `basePath` in den Build backt. */
export const APP_BASE_PATH_ENV = 'OPENAPPS_APP_BASE_PATH';

/** Was die Leiste aus `app.json` braucht. `loadShell(manifest)` passt direkt. */
export interface ShellAppInfo {
  /** Technischer Name, z. B. `crm`. Ueber ihn findet die Leiste diese App. */
  readonly name: string;
  /** Anzeigename, z. B. „CRM“. */
  readonly displayName: string;
}

export interface ShellUserData {
  id: string;
  email: string;
  /** Nur zur Anzeige, nie zur Rechtepruefung. */
  groups: string[];
}

export interface ShellPlatformAppData {
  name: string;
  title: string;
  category: string | null;
  href: string;
}

export interface ShellPlatformData {
  platformUrl: string;
  apps: ShellPlatformAppData[];
  canCreateApps: boolean;
  isAdmin: boolean;
}

/**
 * Props fuer die Leiste, so wie sie `NextPlatformShell` aus
 * `@openapps/ui/next` (oder `PlatformShell` aus `@openapps/ui`) erwartet.
 * Nur einfache Werte, damit sie vom Server an eine Client-Komponente gehen.
 */
export interface ShellData {
  appName: string;
  appTitle: string;
  /** `null`: keine oder ungueltige Navigation — die Leiste zeigt nur diese App. */
  platform: ShellPlatformData | null;
  /** `null`: keine gueltige Identitaet — die Leiste zeigt das Skelett. */
  user: ShellUserData | null;
  /** Pfad der App auf der gemeinsamen Domain, z. B. `/crm`. Lokal `''`. */
  basePath: string;
}

export interface ReadShellOptions extends GetUserOptions {
  /** basePath statt `OPENAPPS_APP_BASE_PATH`. Fuer Tests. */
  readonly basePath?: string | undefined;
}

/**
 * Derselbe Pfad, den `next.config.js` als `basePath` in den Build backt. Die
 * Control Plane setzt `OPENAPPS_APP_BASE_PATH` fuer Build und Laufzeit
 * gleich. Ein unbrauchbarer Wert faellt hier auf `''` zurueck, statt die Seite
 * zu kosten — den Build haette er ohnehin schon abgebrochen.
 */
export function appBasePath(value: string | undefined = process.env[APP_BASE_PATH_ENV]): string {
  const raw = (value ?? '').trim().replace(/\/+$/, '');
  return /^\/[a-z0-9][a-z0-9-]*$/.test(raw) ? raw : '';
}

/**
 * Liest die Daten der Leiste aus den Gateway-Headern. Nur im Server
 * aufrufen: `getUser` und `getNavigation` pruefen die Signaturen mit dem
 * Secret der App, das nie in den Browser darf.
 *
 * Wirft nie. Die Leiste ist Anzeige, keine Freigabe — ob die Person die Seite
 * sehen darf, hat die Forward-Auth schon entschieden, und jede Aktion und
 * jeder Route-Handler prueft `getUser` selbst. Ohne gueltige Identitaet zeigt
 * die Leiste das Skelett, ohne gueltige Navigation nur diese App.
 */
export function readShell(
  headers: HeaderBag,
  app: ShellAppInfo,
  options: ReadShellOptions = {},
): ShellData {
  const { basePath, ...userOptions } = options;
  return {
    appName: app.name,
    appTitle: app.displayName,
    platform: platformFrom(headers, userOptions),
    user: userFrom(headers, userOptions),
    basePath: appBasePath(basePath ?? process.env[APP_BASE_PATH_ENV]),
  };
}

function userFrom(headers: HeaderBag, options: GetUserOptions): ShellUserData | null {
  try {
    const user = getUser(headers, options);
    return { id: user.id, email: user.email, groups: [...user.groups] };
  } catch {
    // Fehlende Konfiguration und ungueltige Signatur gleichermassen: Die
    // Leiste zeigt das Skelett, die Seite selbst prueft `getUser`.
    return null;
  }
}

function platformFrom(headers: HeaderBag, options: GetUserOptions): ShellPlatformData | null {
  // getNavigation wirft nie, `null` heisst: nur die eigene App zeigen.
  const nav = getNavigation(headers, options);
  if (nav === null) return null;
  return {
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
}
