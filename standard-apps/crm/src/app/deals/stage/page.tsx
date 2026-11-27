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
    console.error('[crm] load deals for stage form:', error);
  }

  return (
    <>
      <TextLink href={dealId === '' ? '/pipeline' : `/deals/${dealId}`} className="self-start text-sm">
        ← Back
      </TextLink>
      {options === null ? (
        <ErrorState
          title="Form could not be loaded"
          description="The deals are missing because the database did not respond. Reload the page."
        />
      ) : (
        <StageForm deals={options} dealId={dealId} />
      )}
    </>
  );
}
