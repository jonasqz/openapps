import { Card, CardBody, EmptyState, ErrorState } from '@openapps/ui';
import { Highlighted } from '@/components/Highlighted';
import { SearchBox } from '@/components/SearchBox';
import { TextLink } from '@/components/TextLink';
import type { Passage } from '@/lib/retriever';
import { QUERY_MAX } from '@/lib/schemas';
import { currentRetriever } from '@/lib/tools';

/**
 * Die Suchseite. Dieselbe Suche wie das Tool `search`, nur mit mehr Treffern.
 * Lesen braucht hier keinen `getUser`: Die Seite erreicht nur, wen das
 * Gateway durchlaesst, und sie aendert nichts.
 */
export const dynamic = 'force-dynamic';

const UI_LIMIT = 10;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function SearchPage({ searchParams }: { searchParams: SearchParams }) {
  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim().slice(0, QUERY_MAX) ?? '';

  let passages: Passage[] = [];
  let failed = false;
  if (q !== '') {
    try {
      passages = await currentRetriever().search(q, UI_LIMIT);
    } catch (error) {
      console.error('[knowledge] search:', error);
      failed = true;
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-fg">Knowledge</h1>
          <p className="mt-1 text-sm text-fg-muted">
            Searches the stored documents and shows the matching sections with their source.
          </p>
        </div>
        <TextLink href="/documents/new" className="shrink-0 self-start text-sm">
          Add document
        </TextLink>
      </header>

      <SearchBox initialQuery={q} />

      {q === '' ? (
        <EmptyState
          title="No search yet"
          description="Ask a question or enter keywords. Other word forms are found too, such as “trips” for “trip”."
        />
      ) : failed ? (
        <ErrorState
          title="The search failed"
          description="The database did not respond. Try again in a moment."
        />
      ) : passages.length === 0 ? (
        <EmptyState
          title="No matching sections"
          description="Try different or fewer words. If it is not in any document, you can add it as a document."
        />
      ) : (
        <section aria-labelledby="results" className="flex min-w-0 flex-col gap-3">
          <h2 id="results" className="text-sm font-medium text-fg-muted">
            {passages.length === 1 ? '1 section' : `${passages.length} sections`} for “{q}”
          </h2>
          <ol className="flex min-w-0 flex-col gap-3">
            {passages.map((passage) => (
              <li key={passage.chunkId}>
                <Card>
                  <CardBody className="flex min-w-0 flex-col gap-2">
                    <p className="text-sm leading-relaxed text-fg [overflow-wrap:anywhere]">
                      <Highlighted text={passage.excerpt} />
                    </p>
                    <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-muted">
                      <TextLink href={`/documents/${passage.documentId}#section-${passage.ord + 1}`}>
                        {passage.documentTitle}
                      </TextLink>
                      <span>Section {passage.ord + 1}</span>
                      {passage.source === null ? null : (
                        <span className="[overflow-wrap:anywhere]">Source: {passage.source}</span>
                      )}
                    </p>
                  </CardBody>
                </Card>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
