import type { ReactNode } from 'react';
import { themeScript } from '@openapps/ui';
import '@openapps/ui/tokens.css';
import './globals.css';
import { Shell } from '@/components/Shell';
import { loadShell } from '@/lib/shell';

export const metadata = { title: 'Starter App' };

/**
 * Die Leiste kommt von der Plattform (`PlatformShell` aus `@openapps/ui`,
 * ADR 0017). Uebernimm dieses Layout so, wie es ist:
 *
 * - `loadShell()` (`src/lib/shell.ts`) holt auf dem Server die angemeldete
 *   Person (`getUser`) und die Navigation der Plattform (`getNavigation`)
 *   aus den Gateway-Headern. Es wirft nie.
 * - `Shell` (`src/components/Shell.tsx`) haengt die eigenen Bereiche der App
 *   an und markiert die aktuelle Seite. Nur dort traegst du deine Seiten ein.
 * - `themeScript` setzt die gemerkte Darstellung (hell/dunkel) vor dem ersten
 *   Bild; dafuer `suppressHydrationWarning` auf `<html>`.
 *
 * Keine eigene Navigation, kein Login, kein Profilmenue, kein `<main>` in den
 * Seiten und kein aeusserer Abstand: Rahmen, `<main>` und Innenabstand kommen
 * von der Leiste.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const shell = await loadShell();
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="bg-bg text-fg antialiased">
        <Shell {...shell}>
          {children}
        </Shell>
      </body>
    </html>
  );
}
