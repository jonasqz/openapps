import type { ReactNode } from 'react';
import '@openapps/ui/tokens.css';

export const metadata = { title: 'Starter App' };

/**
 * Die App-Shell kommt von der Plattform. Diese App liefert nur ihren Inhalt —
 * keine eigene Navigation, kein eigener Login, kein eigenes Profilmenü.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
