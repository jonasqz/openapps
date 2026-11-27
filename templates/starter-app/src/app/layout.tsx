import type { ReactNode } from 'react';
import { loadShell } from '@openapps/sdk/next';
import { ThemeScript } from '@openapps/ui';
import { NextPlatformShell, type AppSection } from '@openapps/ui/next';
import '@openapps/ui/tokens.css';
import './globals.css';
import manifest from '../../app.json';

export const metadata = { title: 'Starter App' };

/**
 * Die Bereiche dieser App in der gemeinsamen Leiste (ADR 0017, ADR 0019).
 *
 * DAS IST DIE EINZIGE STELLE, DIE DU IN DIESER DATEI AENDERST (neben
 * `metadata`): ein Eintrag je Seite, die man direkt ansteuert (Listen,
 * Uebersichten). Formulare wie `/items/new` gehoeren meist nicht hierher,
 * sondern als Knopf auf die Liste.
 *
 * - `path`: Pfad innerhalb der App, **ohne** basePath (`/items`, nicht
 *   `/my-app/items`). Den basePath setzt die Leiste davor.
 * - `match` (optional, Default `[path]`): Pfade, unter denen der Eintrag als
 *   aktuelle Seite gilt. `/` gilt nur exakt, alles andere auch fuer
 *   Unterseiten (`/items` -> `/items/42`).
 * - `label`: sichtbarer Text, englisch (ADR 0016).
 */
const SECTIONS = [
  { id: 'items', label: 'Items', path: '/' },
] as const satisfies readonly AppSection[];

/**
 * Die Leiste kommt von der Plattform. Uebernimm den Rest so, wie er ist:
 *
 * - `loadShell(manifest)` (`@openapps/sdk/next`) holt auf dem Server die
 *   angemeldete Person und die Navigation der Plattform aus den
 *   Gateway-Headern. Es wirft nie: ohne gueltige Signatur zeigt die Leiste
 *   nur diese App.
 * - `NextPlatformShell` (`@openapps/ui/next`) rendert `PlatformShell` mit
 *   deinen Bereichen und markiert die aktuelle Seite. Nutzer, Liste der Apps,
 *   „New app“, „New agent“, Settings, Abmelden und Darstellung liefert die
 *   Plattform. Baue nichts davon nach.
 * - `ThemeScript` setzt die gemerkte Darstellung (hell/dunkel) vor dem ersten
 *   Bild; dafuer `suppressHydrationWarning` auf `<html>`.
 *
 * Keine eigene Navigation, kein Login, kein Profilmenue, kein `<main>` in den
 * Seiten und kein aeusserer Abstand: Rahmen, `<main>` und Innenabstand kommen
 * von der Leiste.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const shell = await loadShell(manifest);
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="bg-bg text-fg antialiased">
        <NextPlatformShell {...shell} sections={SECTIONS}>
          {children}
        </NextPlatformShell>
      </body>
    </html>
  );
}
