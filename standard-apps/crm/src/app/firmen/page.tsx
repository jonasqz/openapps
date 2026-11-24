import type { ReactNode } from 'react';
import { Table } from '@openapps/ui';
import { ButtonLink, TextLink } from '@/components/links';
import { listCompanies, type CompanyListItem } from '@/lib/crm';

export const dynamic = 'force-dynamic';

/**
 * Firmen. Dieselbe Liste liefert das Tool `companies.list`.
 *
 * Server-Seite: Spalten nennen nur `field`, was eine Zelle zeigt, steht vorher
 * in der Zeile (`toRow`) — auch der Verweis als fertiges Element.
 */
interface CompanyRow {
  id: string;
  name: ReactNode;
  branche: string;
  kontakte: number;
  offeneDeals: number;
}

const toRow = (company: CompanyListItem): CompanyRow => ({
  id: company.id,
  name: <TextLink href={`/firmen/${company.id}`}>{company.name}</TextLink>,
  branche: company.branche ?? '',
  kontakte: company.contactCount,
  offeneDeals: company.openDealCount,
});

export default async function CompaniesPage() {
  let companies: CompanyListItem[] = [];
  let failed = false;
  try {
    companies = await listCompanies({ limit: 200 });
  } catch (error) {
    console.error('[crm] Firmen laden:', error);
    failed = true;
  }

  return (
    <>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-fg">Firmen</h1>
          <p className="mt-1 text-sm text-fg-muted">Alle Firmen, alphabetisch.</p>
        </div>
        <ButtonLink href="/firmen/neu">Neue Firma</ButtonLink>
      </header>
      <Table<CompanyRow>
        caption="Firmen"
        rows={failed ? [] : companies.map(toRow)}
        columns={[
          { field: 'name', header: 'Name' },
          { field: 'branche', header: 'Branche', hideBelow: 'sm' },
          { field: 'kontakte', header: 'Kontakte', align: 'right', hideBelow: 'md' },
          { field: 'offeneDeals', header: 'Offene Deals', align: 'right' },
        ]}
        empty={{
          title: 'Noch keine Firmen',
          description: 'Lege die erste Firma an, dann erscheint sie hier.',
          action: <ButtonLink href="/firmen/neu">Neue Firma</ButtonLink>,
        }}
        error={
          failed
            ? {
                title: 'Firmen konnten nicht geladen werden',
                description: 'Die Datenbank hat nicht geantwortet. Lade die Seite neu.',
              }
            : undefined
        }
      />
    </>
  );
}
