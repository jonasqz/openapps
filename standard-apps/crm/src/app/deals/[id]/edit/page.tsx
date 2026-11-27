import { notFound } from 'next/navigation';
import { ToolNotFoundError } from '@openapps/sdk';
import { ErrorState } from '@openapps/ui';
import { DealEditForm } from '@/components/forms/DealEditForm';
import { TextLink } from '@/components/links';
import { getDeal, listContacts, type Deal } from '@/lib/crm';
import type { Option } from '@/lib/options';
import { uuid } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

/** Deal bearbeiten. Tool: `deals.update` (die Stage nicht, die hat ihr eigenes Tool). */
export default async function EditDealPage({ params }: { params: Promise<{ id: string }> }) {
  const parsed = uuid.safeParse((await params).id);
  if (!parsed.success) notFound();

  let loaded: { deal: Deal; contacts: Option[] } | null = null;
  try {
    const { deal } = await getDeal(parsed.data);
    const contacts = await listContacts({ companyId: deal.companyId, limit: 200 });
    loaded = { deal, contacts: contacts.map((contact) => ({ value: contact.id, label: contact.name })) };
  } catch (error) {
    if (error instanceof ToolNotFoundError) notFound();
    console.error('[crm] load deal for edit:', error);
  }

  return (
    <>
      <TextLink href={`/deals/${parsed.data}`} className="self-start text-sm">
        ← Back to the deal
      </TextLink>
      {loaded === null ? (
        <ErrorState title="Form could not be loaded" description="The database did not respond. Reload the page." />
      ) : (
        <DealEditForm deal={loaded.deal} contacts={loaded.contacts} />
      )}
    </>
  );
}
