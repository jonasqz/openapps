import { ErrorState } from '@openapps/ui';
import { ActivityForm } from '@/components/forms/ActivityForm';
import { TextLink } from '@/components/links';
import { companyOptions, contactOption, contacts, dealOption, deals, param, type Option } from '@/lib/options';

export const dynamic = 'force-dynamic';

interface Choices {
  companies: Option[];
  contacts: Option[];
  deals: Option[];
  companyOf: Record<string, string>;
}

export default async function NewActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const initial = {
    companyId: param(raw, 'company'),
    contactId: param(raw, 'contact'),
    dealId: param(raw, 'deal'),
  };

  let choices: Choices | null = null;
  try {
    const [companies, people, openDeals] = await Promise.all([companyOptions(), contacts(), deals()]);
    const companyOf: Record<string, string> = {};
    for (const person of people) if (person.companyId !== null) companyOf[person.id] = person.companyId;
    for (const deal of openDeals) companyOf[deal.id] = deal.companyId;
    choices = {
      companies,
      contacts: people.map(contactOption),
      deals: openDeals.map(dealOption),
      companyOf,
    };
  } catch (error) {
    console.error('[crm] load options for activity form:', error);
  }

  return (
    <>
      <TextLink
        href={initial.companyId === '' ? '/' : `/companies/${initial.companyId}`}
        className="self-start text-sm"
      >
        ← Back
      </TextLink>
      {choices === null ? (
        <ErrorState
          title="Form could not be loaded"
          description="The option lists are missing because the database did not respond. Reload the page."
        />
      ) : (
        <ActivityForm
          companies={choices.companies}
          contacts={choices.contacts}
          deals={choices.deals}
          companyOf={choices.companyOf}
          initial={initial}
        />
      )}
    </>
  );
}
