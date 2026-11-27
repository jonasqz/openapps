import { Card, CardBody, EmptyState, ErrorState, PageHeader } from '@openapps/ui';
import { Highlighted } from '@/components/Highlighted';
import { SearchBox } from '@/components/SearchBox';
import { SourceLink } from '@/components/SourceLink';
import { TextLink } from '@/components/TextLink';
import type { Passage } from '@/lib/retriever';
import { QUERY_MAX } from '@/lib/schemas';
import { currentRetriever } from '@/lib/tools';
import { currentViewer, sourceAppDisplay } from '@/lib/viewer';

/**
 * Die Suchseite. Dieselbe Suche wie das Tool `search`, nur mit mehr Treffern.
 * Lesen braucht hier keinen `getUser`: Die Seite erreicht nur, wen das
 * Gateway durchlaesst, und sie aendert nichts. Was aus anderen Apps
 * erscheint, entscheidet die signierte Liste der lesbaren Apps (ADR 0020).
 */
export const dynamic = 'force-dynamic';

const UI_LIMIT = 10;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function SearchPage({ searchParams }: { searchParams: SearchParams }) {
  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim().slice(0, QUERY_MAX) ?? '';

  const viewer = await currentViewer();
  let passages: Passage[] = [];
  let failed = false;
  if (q !== '') {
    try {
      passages = await currentRetriever().search(q, UI_LIMIT, viewer.visibility);
    } catch (error) {
      console.error('[knowledge] search:', error);
      failed = true;
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6">
      <PageHeader
        className="mb-0"
        eyebrow="Knowledge"
        title="Search"
        description="Searches the stored documents and the content of other apps, and shows the matching sections with their source."
        actions={
          <TextLink href="/documents/new" className="shrink-0 self-start text-sm">
            Add document
          </TextLink>
        }
      />

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
                      {passage.sourceApp === null ? null : (
                        <SourceLink
                          {...sourceAppDisplay(viewer, passage.sourceApp, passage.sourcePath)}
                        />
                      )}
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
