import type { ReactNode } from 'react';
import { PageHeader, Table } from '@openapps/ui';
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
  industry: string;
  kontakte: number;
  offeneDeals: number;
}

const toRow = (company: CompanyListItem): CompanyRow => ({
  id: company.id,
  name: <TextLink href={`/companies/${company.id}`}>{company.name}</TextLink>,
  industry: company.industry ?? '',
  kontakte: company.contactCount,
  offeneDeals: company.openDealCount,
});

export default async function CompaniesPage() {
  let companies: CompanyListItem[] = [];
  let failed = false;
  try {
    companies = await listCompanies({ limit: 200 });
  } catch (error) {
    console.error('[crm] load companies:', error);
    failed = true;
  }

  return (
    <>
      <PageHeader
        eyebrow="CRM"
        title="Companies"
        description="All companies, alphabetical."
        actions={<ButtonLink href="/companies/new">New company</ButtonLink>}
      />
      <Table<CompanyRow>
        caption="Companies"
        searchable
        rows={failed ? [] : companies.map(toRow)}
        columns={[
          { field: 'name', header: 'Name' },
          { field: 'industry', header: 'Industry', hideBelow: 'sm' },
          { field: 'kontakte', header: 'Contacts', align: 'right', hideBelow: 'md' },
          { field: 'offeneDeals', header: 'Open deals', align: 'right' },
        ]}
        empty={{
          title: 'No companies yet',
          description: 'Create the first company and it will show up here.',
          action: <ButtonLink href="/companies/new">New company</ButtonLink>,
        }}
        error={
          failed
            ? {
                title: 'Companies could not be loaded',
                description: 'The database did not respond. Reload the page.',
              }
            : undefined
        }
      />
    </>
  );
}
