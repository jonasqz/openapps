/**
 * Die Wurzel der Control Plane. Sie bringt keine eigenen Farbwerte mit — alles
 * kommt aus den Tokens von `@openapps/ui` (docs/05-ui-guide.md, Weg A).
 *
 * Bewusst **ohne** eigene Navigation: Die kommt aus `AppShell` von
 * `@openapps/ui`, damit die Control Plane dieselbe Hülle trägt wie jede App.
 * Sie steht hier noch nicht, weil die Login-Seite außerhalb der Shell liegen
 * muss — ein Navigationsmenü vor der Anmeldung wäre falsch. Nachzuziehen über
 * eine Routengruppe.
 */

import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'openapps Control Plane',
  description: 'Apps, Deployments und Freigaben',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de">
      <body className="min-h-screen bg-bg text-fg antialiased">{children}</body>
    </html>
  );
}
