import { PageHeader } from '@openapps/ui';
import { PageTable } from '@/components/PageTable';
import { listFavorites, type PageSummary } from '@/lib/pages';
import { viewerId } from '@/lib/viewer';

/** Die eigenen Favoriten. Liest wie das Tool `favorites.list`. */
export const dynamic = 'force-dynamic';

export default async function FavoritesPage() {
  let pages: PageSummary[] = [];
  let failed: boolean | { title: string; description: string } = false;
  const viewer = await viewerId();
  if (viewer === undefined) {
    // Favoriten gehoeren einer Person; ohne gepruefte Identitaet gibt es keine.
    failed = {
      title: 'Favorites are not available',
      description: 'Your sign-in could not be confirmed. Reload the page.',
    };
  } else {
    try {
      pages = (await listFavorites(viewer)).pages;
    } catch (error) {
      console.error('[wiki] favorites:', error);
      failed = true;
    }
  }

  return (
    <div className="flex min-w-0 flex-col">
      <PageHeader
        eyebrow="Wiki"
        title="Favorites"
        description="Pages you marked with “Add to favorites”. Only you see your list."
      />
      <PageTable
        caption="Favorite pages"
        pages={pages}
        failed={failed}
        empty={{
          title: 'No favorites yet',
          description: 'Open a page and choose “Add to favorites” to find it here quickly.',
        }}
      />
    </div>
  );
}
