import type { ReactNode } from 'react';
import '@openapps/ui/tokens.css';
import './globals.css';
import { AppNav } from '@/components/AppNav';

export const metadata = { title: 'CRM' };

/**
 * Die App-Shell kommt von der Plattform. Diese App liefert nur ihren Inhalt
 * und die Reiter ihrer eigenen Bereiche — keinen Login, kein Profilmenue.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de">
      <body className="bg-bg text-fg">
        <AppNav />
        <main className="mx-auto flex w-full min-w-0 max-w-screen-xl flex-col gap-6 p-4 sm:p-6">
          {children}
        </main>
      </body>
    </html>
  );
}
