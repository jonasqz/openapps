import { ErrorState } from '@openapps/ui';
import { NextStepForm } from '@/components/forms/NextStepForm';
import { TextLink } from '@/components/links';
import { companyOptions, contactOption, contacts, dealOption, deals, param, type Option } from '@/lib/options';

export const dynamic = 'force-dynamic';

/** Vorschlag fuer die Faelligkeit: in drei Tagen, als Kalendertag in Europe/Berlin. */
function inDays(days: number): string {
  const berlin = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date());
  const [y, m, d] = berlin.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export default async function NewNextStepPage({
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
  const back =
    initial.dealId !== ''
      ? `/deals/${initial.dealId}`
      : initial.contactId !== ''
        ? `/contacts/${initial.contactId}`
        : initial.companyId !== ''
          ? `/companies/${initial.companyId}`
          : '/';

  let choices: { companies: Option[]; contacts: Option[]; deals: Option[] } | null = null;
  try {
    const [companies, people, all] = await Promise.all([companyOptions(), contacts(), deals()]);
    choices = { companies, contacts: people.map(contactOption), deals: all.map(dealOption) };
  } catch (error) {
    console.error('[crm] load options for next step form:', error);
  }

  return (
    <>
      <TextLink href={back} className="self-start text-sm">
        ← Back
      </TextLink>
      {choices === null ? (
        <ErrorState
          title="Form could not be loaded"
          description="The option lists are missing because the database did not respond. Reload the page."
        />
      ) : (
        <NextStepForm
          companies={choices.companies}
          contacts={choices.contacts}
          deals={choices.deals}
          initial={initial}
          defaultDue={inDays(3)}
        />
      )}
    </>
  );
}
