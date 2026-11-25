import { ErrorState } from '@openapps/ui';
import { TextLink } from '@/components/LinkButton';
import { loadPage } from '@/lib/load';
import { PageForm } from '../PageForm';

/** Neue Seite, optional als Unterseite (`?parent=<id>`). Speichert wie `pages.create`. */
export const dynamic = 'force-dynamic';

export default async function NewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawParent = Array.isArray(params.parent) ? params.parent[0] : params.parent;

  let parent: { id: string; title: string } | null = null;
  if (rawParent !== undefined && rawParent !== '') {
    const loaded = await loadPage(rawParent);
    if (loaded.kind !== 'ok' || loaded.value.archivedAt !== null) {
      return (
        <main className="flex flex-col gap-4 p-6">
          <TextLink href="/">← All pages</TextLink>
          <ErrorState
            title={
              loaded.kind === 'failed'
                ? 'Parent page could not be loaded'
                : 'Parent page does not exist or is archived'
            }
            description="Create the page without a parent or choose a different one."
          />
        </main>
      );
    }
    parent = { id: loaded.value.id, title: loaded.value.title };
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
      <PageForm mode="create" parent={parent} />
    </main>
  );
}
