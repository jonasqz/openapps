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
  const companyId = param(await searchParams, 'firma');
  let options: { companies: Option[]; contacts: Option[] } | null = null;
  try {
    const [companies, people] = await Promise.all([companyOptions(), contacts()]);
    options = { companies, contacts: people.map(contactOption) };
  } catch (error) {
    console.error('[crm] Auswahl fuer Deal-Formular laden:', error);
  }

  return (
    <>
      <TextLink href={companyId === '' ? '/' : `/firmen/${companyId}`} className="self-start text-sm">
        ← Zurück
      </TextLink>
      {options === null ? (
        <ErrorState
          title="Formular konnte nicht geladen werden"
          description="Firmen und Kontakte fehlen, weil die Datenbank nicht geantwortet hat. Lade die Seite neu."
        />
      ) : options.companies.length === 0 ? (
        <ErrorState
          title="Erst eine Firma anlegen"
          description="Ein Deal gehört immer zu einer Firma. Lege zuerst eine an."
          action={<TextLink href="/firmen/neu">Neue Firma</TextLink>}
        />
      ) : (
        <DealForm companies={options.companies} contacts={options.contacts} companyId={companyId} />
      )}
    </>
  );
}
