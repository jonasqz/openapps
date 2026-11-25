import { ContactsList, type ContactListRow } from '@/components/ContactsList';
import { listCompanies, listContacts, type CompanyListItem, type Contact } from '@/lib/crm';
import { ContactsListArgs } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

/**
 * Kontakte mit Suche. Suche und Firmenfilter stehen in der URL (`?q=`,
 * `?company=`), damit ein Link genau diese Liste wieder zeigt. Dieselbe Abfrage
 * liefert das Tool `contacts.list`.
 */
export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const q = typeof raw.q === 'string' ? raw.q : '';
  const firma = typeof raw.company === 'string' ? raw.company : '';
  // Ungueltige Filter aus der URL ignorieren statt die Seite scheitern zu lassen.
  const parsed = ContactsListArgs.safeParse({ q, companyId: firma, limit: 200 });
  const args = parsed.success ? parsed.data : { limit: 200 };

  let contacts: Contact[] = [];
  let companies: CompanyListItem[] = [];
  let failed = false;
  try {
    [contacts, companies] = await Promise.all([listContacts(args), listCompanies({ limit: 200 })]);
  } catch (error) {
    console.error('[crm] load contacts:', error);
    failed = true;
  }

  const rows: ContactListRow[] = contacts.map((contact) => ({
    id: contact.id,
    name: contact.name,
    role: contact.role ?? '',
    email: contact.email ?? '',
    phone: contact.phone ?? '',
    companyId: contact.companyId ?? '',
    companyName: contact.companyName ?? '',
  }));

  return (
    <ContactsList
      rows={rows}
      failed={failed}
      initialQuery={q}
      companyId={parsed.success ? (parsed.data.companyId ?? '') : ''}
      companies={companies.map((company) => ({ value: company.id, label: company.name }))}
    />
  );
}
