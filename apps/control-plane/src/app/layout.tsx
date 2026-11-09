/**
 * Die Shell der Control Plane. Sie bringt keine eigenen Farbwerte mit — alles
 * kommt aus den Tokens von `@openapps/ui` (docs/05-ui-guide.md, Weg A).
 */

import type { ReactNode } from 'react';
import '@openapps/ui/styles.css';

export const metadata = {
  title: 'openapps Control Plane',
  description: 'Apps, Deployments und Freigaben',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de">
      <body>
        <nav aria-label="Hauptnavigation">
          <a href="/">Apps</a>
          <a href="/grants">Freigaben</a>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
