import { notFound } from 'next/navigation';
import { Card, CardBody, CardHeader, DetailPattern, EmptyState, ErrorState } from '@openapps/ui';
import { ToolNotFoundError } from '@openapps/sdk';
import { DeleteDocumentButton } from '@/components/DeleteDocumentButton';
import { TextLink } from '@/components/TextLink';
import { getDocument, type Chunk, type DocumentDetail } from '@/lib/documents';
import { GetArgs } from '@/lib/schemas';

/**
 * Dokument-Detail mit Abschnitten, dasselbe wie das Tool `documents.get` mit
 * `includeChunks: true`. Die Abschnitte tragen Anker `#section-<n>`, auf
 * die die Trefferliste der Suche zeigt.
 */
export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;

export default async function DocumentPage({ params }: { params: Params }) {
  const parsed = GetArgs.safeParse({ id: (await params).id, includeChunks: true });
  if (!parsed.success) notFound();

  let document: DocumentDetail | undefined;
  let chunks: Chunk[] = [];
  let failed = false;
  try {
    const result = await getDocument(parsed.data);
    document = result.document;
    chunks = result.chunks ?? [];
  } catch (error) {
    if (error instanceof ToolNotFoundError) notFound();
    console.error('[knowledge] document:', error);
    failed = true;
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-4">
      <TextLink href="/documents" className="self-start text-sm">
        ← All documents
      </TextLink>
      {failed || document === undefined ? (
        <ErrorState
          title="The document could not be loaded"
          description="The database did not respond. Reload the page."
        />
      ) : (
        <DetailPattern
          title={document.title}
          eyebrow="Document"
          actions={<DeleteDocumentButton id={document.id} title={document.title} />}
          sections={[
            {
              title: 'Details',
              fields: [
                { label: 'Source', value: document.source ?? '—', wide: true },
                { label: 'Characters', value: document.charCount.toLocaleString('en-GB') },
                { label: 'Sections', value: document.chunkCount },
                { label: 'Created by', value: document.createdBy },
                {
                  label: 'Created at',
                  value: new Date(document.createdAt).toLocaleString('en-GB'),
                },
                { label: 'Id', value: document.id, wide: true },
              ],
            },
          ]}
        >
          <section aria-labelledby="sections" className="flex min-w-0 flex-col gap-3">
            <h2 id="sections" className="text-lg font-semibold text-fg">
              Sections
            </h2>
            {chunks.length === 0 ? (
              <EmptyState
                title="Not split into sections yet"
                description="The document will be split the next time the app starts. Until then, search will not find it."
              />
            ) : (
              <ol className="flex min-w-0 flex-col gap-3">
                {chunks.map((chunk) => (
                  <li key={chunk.id} id={`section-${chunk.ord + 1}`} className="scroll-mt-4">
                    <Card>
                      <CardHeader as="h3" title={`Section ${chunk.ord + 1}`} />
                      <CardBody>
                        <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg [overflow-wrap:anywhere]">
                          {chunk.text}
                        </p>
                      </CardBody>
                    </Card>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </DetailPattern>
      )}
    </div>
  );
}
