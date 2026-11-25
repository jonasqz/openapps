import type { ReactNode } from 'react';
import { themeScript } from '@openapps/ui';
import '@openapps/ui/tokens.css';
import './globals.css';
import { Shell } from '@/components/Shell';
import { loadShell } from '@/lib/shell';

export const metadata = { title: 'Knowledge' };

/**
 * Die Leiste kommt von der Plattform (`PlatformShell`, ADR 0017). Diese App
 * liefert nur ihren Inhalt und ihre eigenen Bereiche (`Shell`) — keinen
 * Login, kein Profilmenue, keine App-Liste.
 *
 * `suppressHydrationWarning`: `themeScript` setzt `data-theme` auf `<html>`,
 * bevor React hydriert.
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
