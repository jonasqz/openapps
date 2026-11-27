import type { ReactNode } from 'react';
import { loadShell } from '@openapps/sdk/next';
import { ThemeScript } from '@openapps/ui';
import { NextPlatformShell, type AppSection } from '@openapps/ui/next';
import '@openapps/ui/tokens.css';
import './globals.css';
import manifest from '../../app.json';

export const metadata = { title: 'Wiki' };

/**
 * Die Bereiche dieser App in der gemeinsamen Leiste (ADR 0017, ADR 0019).
 * Nutzer, App-Liste, „New app“, Settings und Abmelden liefert die Plattform.
 */
const SECTIONS = [
  { id: 'pages', label: 'All pages', path: '/', match: ['/', '/pages'] },
  { id: 'favorites', label: 'Favorites', path: '/favorites' },
  { id: 'recent', label: 'Recently edited', path: '/recent' },
  { id: 'new', label: 'New page', path: '/new' },
] as const satisfies readonly AppSection[];

/**
 * Die Leiste kommt von der Plattform (`PlatformShell`, ADR 0017). Diese App
 * liefert nur ihren Inhalt und ihre eigenen Bereiche (`SECTIONS`) — keinen
 * Login, kein Profilmenue, keine App-Liste.
 *
 * `loadShell` (`@openapps/sdk/next`) liest Person und Navigation aus den
 * Gateway-Headern und wirft nie (ADR 0019). `suppressHydrationWarning`:
 * `ThemeScript` setzt `data-theme` auf `<html>`, bevor React hydriert.
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
