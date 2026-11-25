/**
 * Die Wurzel der Control Plane. Sie bringt keine eigenen Farbwerte mit — alles
 * kommt aus den Tokens von `@openapps/ui` (docs/05-ui-guide.md, Weg A).
 *
 * Bewusst **ohne** eigene Navigation: Die `AppShell` aus `@openapps/ui`
 * steht in der Routengruppe `(verwaltung)`, damit die Login-Seite außerhalb
 * bleibt. Ein Navigationsmenü vor der Anmeldung wäre falsch.
 */

import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'openapps Control Plane',
  description: 'Apps, deployments and grants',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg text-fg antialiased">{children}</body>
    </html>
  );
}
