import { notFound } from 'next/navigation';
import { ErrorState } from '@openapps/ui';
import { TextLink } from '@/components/LinkButton';
import { loadPage } from '@/lib/load';
import { PageForm } from '../../../PageForm';

/** Seite bearbeiten. Speichert wie das Tool `pages.update` und schreibt eine Revision. */
export const dynamic = 'force-dynamic';

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await loadPage(id);
  if (loaded.kind === 'missing') notFound();

  if (loaded.kind === 'failed' || loaded.value.archivedAt !== null) {
    return (
      <main className="flex flex-col gap-4 p-6">
        <TextLink href={`/pages/${id}`}>← Zur Seite</TextLink>
        <ErrorState
          title={
            loaded.kind === 'failed'
              ? 'Seite konnte nicht geladen werden'
              : 'Archivierte Seiten können nicht bearbeitet werden'
          }
          {...(loaded.kind === 'failed'
            ? { description: 'Die Datenbank hat nicht geantwortet. Lade die Seite neu.' }
            : {})}
        />
      </main>
    );
  }

  const page = loaded.value;
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
      <TextLink href={`/pages/${page.id}`}>← Zur Seite</TextLink>
      <PageForm
        mode="edit"
        id={page.id}
        initial={{ title: page.title, tags: page.tags, contentMd: page.contentMd }}
      />
    </main>
  );
}
