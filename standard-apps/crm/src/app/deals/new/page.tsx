import { ErrorState } from '@openapps/ui';
import { DealForm } from '@/components/forms/DealForm';
import { TextLink } from '@/components/links';
import { companyOptions, contactOption, contacts, param, type Option } from '@/lib/options';

export const dynamic = 'force-dynamic';

export default async function NewDealPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const companyId = param(await searchParams, 'company');
  let options: { companies: Option[]; contacts: Option[] } | null = null;
  try {
    const [companies, people] = await Promise.all([companyOptions(), contacts()]);
    options = { companies, contacts: people.map(contactOption) };
  } catch (error) {
    console.error('[crm] load options for deal form:', error);
  }

  return (
    <>
      <TextLink href={companyId === '' ? '/' : `/companies/${companyId}`} className="self-start text-sm">
        ← Back
      </TextLink>
      {options === null ? (
        <ErrorState
          title="Form could not be loaded"
          description="Companies and contacts are missing because the database did not respond. Reload the page."
        />
      ) : options.companies.length === 0 ? (
        <ErrorState
          title="Create a company first"
          description="A deal always belongs to a company. Create one first."
          action={<TextLink href="/companies/new">New company</TextLink>}
        />
      ) : (
        <DealForm companies={options.companies} contacts={options.contacts} companyId={companyId} />
      )}
    </>
  );
}
