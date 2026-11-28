/**
 * Hilfen der gemeinsamen Leiste (ADR 0017): sichere Adressen, Monogramme,
 * der Befehl fuer „New app“ und die gemerkte Darstellung.
 *
 * Alles hier ist rein und ohne React, damit es sich einzeln testen laesst.
 */
import type { ShellTheme } from './types.ts';

/**
 * Nur `http(s)://…` und pfadrelative Adressen (`/crm`). Alles andere faellt
 * weg, vor allem `javascript:` und `data:`. Auch `//host` und `/\host`
 * fallen weg: Browser lesen beides als Adresse auf einem fremden Host.
 *
 * Die Navigation kommt signiert vom Gateway, aber die Leiste verlaesst sich
 * nicht darauf: Ein Fehler dort darf kein Skript in jede App bringen.
 */
export function safeHref(href: string | null | undefined): string | null {
  if (typeof href !== 'string') return null;
  const value = href.trim();
  if (value === '') return null;
  // Steuerzeichen entfernt der Browser vor dem Lesen des Schemas — dann
  // lieber gar nicht verlinken.
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  if (/^https?:\/\/[^/\\]/i.test(value)) return value;
  if (value.startsWith('/') && !/^\/[/\\]/.test(value)) return value;
  return null;
}

/** Adresse unter der Plattform, z. B. `/settings`. `null` ohne gueltige Plattform. */
export function platformLink(platformUrl: string | null | undefined, path = ''): string | null {
  const base = safeHref(platformUrl);
  if (base === null) return null;
  return `${base.replace(/\/+$/, '')}${path}`;
}

/** Ein oder zwei Buchstaben fuer die Kachel: „CRM“ → „C“, „Leave requests“ → „LR“. */
export function monogramOf(title: string): string {
  const words = title
    .trim()
    .split(/[\s._-]+/)
    .filter((word) => word.length > 0);
  if (words.length === 0) return '?';
  const first = Array.from(words[0]!)[0] ?? '?';
  const second = words.length > 1 ? (Array.from(words[1]!)[0] ?? '') : '';
  return `${first}${second}`.toUpperCase();
}

/**
 * Toene der Kacheln. Nur Tokens, und nur die eine Akzentfarbe plus Graustufen
 * (ADR 0010): Erfolg, Warnung und Gefahr bleiben fuer Zustaende reserviert.
 * Jedes Paar ist in `tokens.contrast.test.ts` nachgerechnet.
 */
export const MONOGRAM_TONES = [
  'bg-primary-subtle text-primary-subtle-fg',
  'bg-surface-muted text-fg-muted',
  'bg-bg text-fg-muted ring-1 ring-inset ring-border',
] as const;

/** Fester Ton je App-Name: dieselbe App sieht in jeder App gleich aus. */
export function monogramTone(name: string): (typeof MONOGRAM_TONES)[number] {
  // FNV-1a, 32 Bit. Klein, stabil, ohne Abhaengigkeit.
  let hash = 0x811c9dc5;
  for (let index = 0; index < name.length; index += 1) {
    hash ^= name.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return MONOGRAM_TONES[hash % MONOGRAM_TONES.length]!;
}

/** Der Slash-Befehl des openapps-Plugins. Kein Oberflaechentext, deshalb hier. */
export const NEW_APP_COMMAND = '/openapps:new-app';

/**
 * Befehl fuer den eigenen Assistenten. Eine Zeile, weil ein Slash-Befehl an
 * der ersten Zeile endet. `null`, solange keine Beschreibung da ist.
 */
export function newAppCommand(name: string, description: string): string | null {
  const flat = (value: string): string => value.replace(/\s+/g, ' ').trim();
  const cleanName = flat(name).replace(/:+$/, '');
  const cleanDescription = flat(description);
  if (cleanDescription === '') return null;
  return cleanName === ''
    ? `${NEW_APP_COMMAND} ${cleanDescription}`
    : `${NEW_APP_COMMAND} ${cleanName}: ${cleanDescription}`;
}

/** Schluessel in `localStorage`. Gilt fuer alle Apps auf demselben Host. */
export const THEME_STORAGE_KEY = 'openapps.theme';
export const SIDEBAR_STORAGE_KEY = 'openapps.sidebar';

function isTheme(value: unknown): value is ShellTheme {
  return value === 'system' || value === 'light' || value === 'dark';
}

/** Gemerkte Darstellung. Ohne Speicher (privates Fenster, Server) `system`. */
export function readTheme(): ShellTheme {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

/**
 * Setzt `data-theme` auf `<html>` — `tokens.css` liest genau das. `system`
 * entfernt das Attribut, dann gilt `prefers-color-scheme`.
 */
export function applyTheme(theme: ShellTheme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

export function storeTheme(theme: ShellTheme): void {
  try {
    if (theme === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Kein Speicher: die Wahl gilt dann nur bis zum Neuladen.
  }
}

export function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'collapsed';
  } catch {
    return false;
  }
}

export function storeCollapsed(collapsed: boolean): void {
  try {
    if (collapsed) window.localStorage.setItem(SIDEBAR_STORAGE_KEY, 'collapsed');
    else window.localStorage.removeItem(SIDEBAR_STORAGE_KEY);
  } catch {
    // Kein Speicher: die Leiste merkt sich den Zustand nur bis zum Neuladen.
  }
}

/**
 * Kleines Skript fuer `<head>`, damit die gemerkte Darstellung vor dem ersten
 * Bild gilt (kein Aufblitzen in Hell). Eine App setzt es so ein:
 *
 * ```tsx
 * <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
 * ```
 *
 * Ohne das Skript stimmt die Darstellung erst nach dem Hydrieren.
 */
export const themeScript =
  `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});` +
  `if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;
