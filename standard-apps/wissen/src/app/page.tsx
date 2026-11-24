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
      console.error('[wissen] Suche:', error);
      failed = true;
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-fg">Wissen</h1>
          <p className="mt-1 text-sm text-fg-muted">
            Durchsucht die abgelegten Dokumente und zeigt die passenden Abschnitte mit Quelle.
          </p>
        </div>
        <nav aria-label="Wissen" className="flex shrink-0 flex-wrap gap-4 text-sm">
          <TextLink href="/dokumente">Dokumente</TextLink>
          <TextLink href="/dokumente/neu">Dokument hinzufügen</TextLink>
        </nav>
      </header>

      <SearchBox initialQuery={q} />

      {q === '' ? (
        <EmptyState
          title="Noch keine Suche"
          description="Stell eine Frage oder gib Stichwörter ein. Gefunden werden auch andere Wortformen, etwa „Reisen“ für „Reise“."
        />
      ) : failed ? (
        <ErrorState
          title="Die Suche ist fehlgeschlagen"
          description="Die Datenbank hat nicht geantwortet. Versuche es gleich noch einmal."
        />
      ) : passages.length === 0 ? (
        <EmptyState
          title="Keine passenden Abschnitte"
          description="Versuche andere oder weniger Wörter. Steht es in keinem Dokument, kannst du es als Dokument hinzufügen."
        />
      ) : (
        <section aria-labelledby="treffer" className="flex min-w-0 flex-col gap-3">
          <h2 id="treffer" className="text-sm font-medium text-fg-muted">
            {passages.length === 1 ? '1 Abschnitt' : `${passages.length} Abschnitte`} zu „{q}“
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
                      <TextLink href={`/dokumente/${passage.documentId}#abschnitt-${passage.ord + 1}`}>
                        {passage.documentTitle}
                      </TextLink>
                      <span>Abschnitt {passage.ord + 1}</span>
                      {passage.source === null ? null : (
                        <span className="[overflow-wrap:anywhere]">Quelle: {passage.source}</span>
                      )}
                    </p>
                  </CardBody>
                </Card>
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}
