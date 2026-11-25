import Link from 'next/link';
import type { JSX } from 'react';

/**
 * Bereiche des CRM. Keine Plattform-Navigation — die liefert die Shell —,
 * nur die Reiter innerhalb dieser App.
 */
const ITEMS = [
  { href: '/', label: 'Pipeline' },
  { href: '/companies', label: 'Companies' },
  { href: '/contacts', label: 'Contacts' },
] as const;

export function AppNav(): JSX.Element {
  return (
    <nav aria-label="CRM sections" className="border-b border-border bg-surface">
      <div className="flex flex-wrap gap-1 px-4 py-2 sm:px-6">
        {ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-hover outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            {item.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
