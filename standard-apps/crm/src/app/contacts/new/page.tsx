import { ErrorState } from '@openapps/ui';
import { ContactForm } from '@/components/forms/ContactForm';
import { TextLink } from '@/components/links';
import { companyOptions, param, type Option } from '@/lib/options';

export const dynamic = 'force-dynamic';

export default async function NewContactPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const companyId = param(await searchParams, 'company');
  let companies: Option[] | null = null;
  try {
    companies = await companyOptions();
  } catch (error) {
    console.error('[crm] load companies for form:', error);
  }

  return (
    <>
      <TextLink href={companyId === '' ? '/contacts' : `/companies/${companyId}`} className="self-start text-sm">
        ← Back
      </TextLink>
      {companies === null ? (
        <ErrorState
          title="Form could not be loaded"
          description="The list of companies is missing because the database did not respond. Reload the page."
        />
      ) : (
        <ContactForm companies={companies} companyId={companyId} />
      )}
    </>
  );
}
