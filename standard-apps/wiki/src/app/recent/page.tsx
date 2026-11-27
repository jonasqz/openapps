import { PageHeader } from '@openapps/ui';
import { PageTable } from '@/components/PageTable';
import { listPages, type PageSummary } from '@/lib/pages';

/** Zuletzt geaenderte Seiten. Liest wie `pages.list` mit `sort: 'updated'`. */
export const dynamic = 'force-dynamic';

const RECENT_LIMIT = 50;

export default async function RecentPage() {
  let pages: PageSummary[] = [];
  let failed = false;
  try {
    pages = (await listPages({ sort: 'updated', limit: RECENT_LIMIT })).pages;
  } catch (error) {
    console.error('[wiki] recent:', error);
    failed = true;
  }

  return (
    <div className="flex min-w-0 flex-col">
      <PageHeader
        eyebrow="Wiki"
        title="Recently edited"
        description={`The ${RECENT_LIMIT} most recently changed pages, by humans and agents.`}
      />
      <PageTable
        caption="Recently edited pages"
        pages={pages}
        failed={failed}
        empty={{
          title: 'No pages yet',
          description: 'Create the first page with “New page”.',
        }}
      />
    </div>
  );
}
