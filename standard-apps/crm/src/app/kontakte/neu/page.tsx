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
  const companyId = param(await searchParams, 'firma');
  let companies: Option[] | null = null;
  try {
    companies = await companyOptions();
  } catch (error) {
    console.error('[crm] Firmen fuer Formular laden:', error);
  }

  return (
    <>
      <TextLink href={companyId === '' ? '/kontakte' : `/firmen/${companyId}`} className="self-start text-sm">
        ← Zurück
      </TextLink>
      {companies === null ? (
        <ErrorState
          title="Formular konnte nicht geladen werden"
          description="Die Liste der Firmen fehlt, weil die Datenbank nicht geantwortet hat. Lade die Seite neu."
        />
      ) : (
        <ContactForm companies={companies} companyId={companyId} />
      )}
    </>
  );
}
