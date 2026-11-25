import type { ReactNode } from 'react';
import '@openapps/ui/tokens.css';
import './globals.css';

export const metadata = { title: 'Tasks' };

/**
 * Die App-Shell kommt von der Plattform. Diese App liefert nur ihren Inhalt —
 * keine eigene Navigation, kein eigener Login, kein eigenes Profilmenü.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-bg text-fg">
        <main className="mx-auto flex w-full min-w-0 max-w-screen-xl flex-col gap-6 p-4 sm:p-6">
          {children}
        </main>
      </body>
    </html>
  );
}
