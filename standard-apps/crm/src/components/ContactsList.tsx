'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type JSX } from 'react';
import { ListPattern, type SelectOption } from '@openapps/ui';
import { ButtonLink } from './links';

export interface ContactListRow {
  id: string;
  name: string;
  role: string;
  email: string;
  phone: string;
  companyId: string;
  companyName: string;
}

/** Wartezeit nach dem letzten Tastendruck, bevor gesucht wird. */
const SEARCH_DELAY_MS = 300;

export function ContactsList({
  rows,
  failed,
  initialQuery,
  companyId,
  companies,
}: {
  rows: readonly ContactListRow[];
  failed: boolean;
  initialQuery: string;
  companyId: string;
  companies: readonly SelectOption[];
}): JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState(initialQuery);
  const [firma, setFirma] = useState(companyId);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = setTimeout(() => {
      const params = new URLSearchParams();
      if (q.trim() !== '') params.set('q', q.trim());
      if (firma !== '') params.set('firma', firma);
      const search = params.toString();
      router.replace(search === '' ? pathname : `${pathname}?${search}`);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [q, firma, pathname, router]);

  const filtersActive = q.trim() !== '' || firma !== '';

  return (
    <ListPattern<ContactListRow>
      title="Kontakte"
      description="Alle Ansprechpartner. Die Suche findet Name, E-Mail, Telefon und Rolle."
      actions={<ButtonLink href="/kontakte/neu">Neuer Kontakt</ButtonLink>}
      search={{ label: 'Suche', value: q, onChange: setQ, placeholder: 'Name, E-Mail, Rolle …' }}
      filters={[
        {
          id: 'firma',
          label: 'Firma',
          options: companies,
          value: firma,
          onChange: setFirma,
          placeholder: 'Alle Firmen',
        },
      ]}
      filtersActive={filtersActive}
      onResetFilters={() => {
        setQ('');
        setFirma('');
      }}
      rows={rows}
      columns={[
        { field: 'name', header: 'Name' },
        {
          key: 'firma',
          header: 'Firma',
          hideBelow: 'sm',
          cell: (row) =>
            row.companyId === '' ? (
              '—'
            ) : (
              <Link
                href={`/firmen/${row.companyId}`}
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                {row.companyName}
              </Link>
            ),
        },
        { field: 'role', header: 'Rolle', hideBelow: 'md' },
        { field: 'email', header: 'E-Mail', hideBelow: 'lg' },
        { field: 'phone', header: 'Telefon', hideBelow: 'lg' },
      ]}
      empty={{
        title: 'Noch keine Kontakte',
        description: 'Lege den ersten Kontakt an, dann erscheint er hier.',
        action: <ButtonLink href="/kontakte/neu">Neuer Kontakt</ButtonLink>,
      }}
      emptyFiltered={{
        title: 'Keine Treffer',
        description: 'Kein Kontakt passt zu Suche oder Filter.',
      }}
      {...(failed
        ? {
            error: {
              title: 'Kontakte konnten nicht geladen werden',
              description: 'Die Datenbank hat nicht geantwortet.',
              retry: () => router.refresh(),
            },
          }
        : {})}
    />
  );
}
