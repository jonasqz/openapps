import { notFound } from 'next/navigation';
import { ErrorState } from '@openapps/ui';
import { TextLink } from '@/components/LinkButton';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { loadLinkTargets, loadPage } from '@/lib/load';
import { PageForm } from '../../../PageForm';

/** Seite bearbeiten. Speichert wie das Tool `pages.update` und schreibt eine Revision. */
export const dynamic = 'force-dynamic';

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await loadPage(id);
  if (loaded.kind === 'missing') notFound();

  if (loaded.kind === 'failed' || loaded.value.archivedAt !== null) {
    return (
      <div className="flex min-w-0 flex-col gap-4">
        <TextLink href={`/pages/${id}`}>← Back to page</TextLink>
        <ErrorState
          title={
            loaded.kind === 'failed'
              ? 'Page could not be loaded'
              : 'Archived pages cannot be edited'
          }
          {...(loaded.kind === 'failed'
            ? { description: 'The database did not respond. Reload the page.' }
            : {})}
        />
      </div>
    );
  }

  const page = loaded.value;
  const linkTargets = await loadLinkTargets(page.id);
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-4">
      <Breadcrumbs path={page.path} current={{ id: page.id, title: page.title, href: true }} />
      <PageForm
        mode="edit"
        id={page.id}
        initial={{ title: page.title, tags: page.tags, contentMd: page.contentMd }}
        updatedAt={page.updatedAt}
        linkTargets={linkTargets}
      />
    </div>
  );
}
