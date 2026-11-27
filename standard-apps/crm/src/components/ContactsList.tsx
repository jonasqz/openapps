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
      if (firma !== '') params.set('company', firma);
      const search = params.toString();
      router.replace(search === '' ? pathname : `${pathname}?${search}`);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [q, firma, pathname, router]);

  const filtersActive = q.trim() !== '' || firma !== '';

  return (
    <ListPattern<ContactListRow>
      title="Contacts"
      description="All contacts. Search matches name, email, phone and role."
      actions={<ButtonLink href="/contacts/new">New contact</ButtonLink>}
      search={{ label: 'Search', value: q, onChange: setQ, placeholder: 'Name, email, role …' }}
      filters={[
        {
          id: 'company',
          label: 'Company',
          options: companies,
          value: firma,
          onChange: setFirma,
          placeholder: 'All companies',
        },
      ]}
      filtersActive={filtersActive}
      onResetFilters={() => {
        setQ('');
        setFirma('');
      }}
      rows={rows}
      columns={[
        {
          key: 'name',
          header: 'Name',
          cell: (row) => (
            <Link
              href={`/contacts/${row.id}`}
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              {row.name}
            </Link>
          ),
        },
        {
          key: 'company',
          header: 'Company',
          hideBelow: 'sm',
          cell: (row) =>
            row.companyId === '' ? (
              '—'
            ) : (
              <Link
                href={`/companies/${row.companyId}`}
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                {row.companyName}
              </Link>
            ),
        },
        { field: 'role', header: 'Role', hideBelow: 'md' },
        { field: 'email', header: 'Email', hideBelow: 'lg' },
        { field: 'phone', header: 'Phone', hideBelow: 'lg' },
      ]}
      empty={{
        title: 'No contacts yet',
        description: 'Create the first contact and it will show up here.',
        action: <ButtonLink href="/contacts/new">New contact</ButtonLink>,
      }}
      emptyFiltered={{
        title: 'No matches',
        description: 'No contact matches the search or filter.',
      }}
      {...(failed
        ? {
            error: {
              title: 'Contacts could not be loaded',
              description: 'The database did not respond.',
              retry: () => router.refresh(),
            },
          }
        : {})}
    />
  );
}
