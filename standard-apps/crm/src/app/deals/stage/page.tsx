import { ErrorState } from '@openapps/ui';
import { StageForm } from '@/components/forms/StageForm';
import { TextLink } from '@/components/links';
import { dealOption, deals, param, type Option } from '@/lib/options';

export const dynamic = 'force-dynamic';

export default async function DealStagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const dealId = param(await searchParams, 'deal');
  let options: Option[] | null = null;
  try {
    options = (await deals()).map(dealOption);
  } catch (error) {
    console.error('[crm] Deals fuer Stage-Formular laden:', error);
  }

  return (
    <>
      <TextLink href="/" className="self-start text-sm">
        ← Pipeline
      </TextLink>
      {options === null ? (
        <ErrorState
          title="Formular konnte nicht geladen werden"
          description="Die Deals fehlen, weil die Datenbank nicht geantwortet hat. Lade die Seite neu."
        />
      ) : (
        <StageForm deals={options} dealId={dealId} />
      )}
    </>
  );
}
