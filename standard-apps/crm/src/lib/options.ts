import { listCompanies, listContacts, listDeals, type Contact, type Deal } from './crm';
import { STAGE_LABELS } from './domain';
import { formatEuro } from './format';

/**
 * Auswahllisten fuer die Formulare. Nur Werte und Beschriftungen — keine
 * Funktionen, damit sie von der Server-Seite in das Client-Formular duerfen.
 */
export interface Option {
  value: string;
  label: string;
}

export async function companyOptions(): Promise<Option[]> {
  const companies = await listCompanies({ limit: 200 });
  return companies.map((company) => ({ value: company.id, label: company.name }));
}

export async function contacts(): Promise<Contact[]> {
  return listContacts({ limit: 200 });
}

export const contactOption = (contact: Contact): Option => ({
  value: contact.id,
  label: contact.companyName === null ? contact.name : `${contact.name} (${contact.companyName})`,
});

export async function deals(): Promise<Deal[]> {
  return listDeals({ limit: 200 });
}

export const dealOption = (deal: Deal): Option => ({
  value: deal.id,
  label: `${deal.title} — ${deal.companyName}, ${formatEuro(deal.valueCents)}, ${STAGE_LABELS[deal.stage]}`,
});

/** Ein Wert aus den Suchparametern, nur wenn er eine einfache Zeichenkette ist. */
export function param(raw: Record<string, string | string[] | undefined>, name: string): string {
  const value = raw[name];
  return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value) ? value : '';
}
