import type { ReactNode } from 'react';
import '@openapps/ui/tokens.css';
import './globals.css';

export const metadata = { title: 'Knowledge' };

/**
 * Die App-Shell kommt von der Plattform. Diese App liefert nur ihren Inhalt —
 * keine eigene Navigation, kein eigener Login, kein eigenes Profilmenü.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
