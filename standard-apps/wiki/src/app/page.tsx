import { listPages, searchPages } from '@/lib/pages';
import { formatDateTime } from '@/lib/format';
import { LIMITS, Tag } from '@/lib/schemas';
import { toTreeRows } from '@/lib/tree';
import { PageList } from './PageList';
import type { PageRow } from '@/lib/tree';

/**
 * Startseite: alle Seiten als Baum, oder die Treffer der Volltextsuche.
 *
 * Gelesen wird ueber dieselben Funktionen wie die Tools `pages.list` und
 * `pages.search`. Lesen braucht hier keine eigene Pruefung: Das Gateway hat
 * die Anfrage nur durchgelassen, weil die Freigabe passt.
 */
export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? '';

export default async function WikiHome({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const q = first(params.q).trim().slice(0, LIMITS.queryMax);
  const parsedTag = Tag.safeParse(first(params.tag));
  const tag = parsedTag.success ? parsedTag.data : '';

  let rows: PageRow[] = [];
  let tagOptions: string[] = [];
  let truncated = false;
  let failed = false;

  try {
    const all = await listPages({});
    truncated = all.truncated;
    tagOptions = [...new Set(all.pages.flatMap((page) => page.tags))].sort((a, b) =>
      a.localeCompare(b, 'de'),
    );

    if (q !== '') {
      const { hits } = await searchPages({ query: q, limit: LIMITS.searchLimitMax });
      rows = hits
        .filter((hit) => tag === '' || hit.tags.includes(tag))
        .map((hit) => ({
          id: hit.id,
          title: hit.title,
          depth: 0,
          tags: hit.tags,
          updatedAt: formatDateTime(hit.updatedAt),
          snippet: hit.snippet,
        }));
    } else if (tag !== '') {
      rows = toTreeRows(all.pages.filter((page) => page.tags.includes(tag))).map((row) => ({
        ...row,
        depth: 0,
      }));
    } else {
      rows = toTreeRows(all.pages);
    }
  } catch (error) {
    console.error('[wiki] Startseite:', error);
    failed = true;
  }

  return (
    <main className="p-6">
      <PageList
        mode={q === '' ? 'tree' : 'search'}
        rows={rows}
        q={q}
        tag={tag}
        tagOptions={tagOptions}
        failed={failed}
        truncated={truncated}
      />
    </main>
  );
}
