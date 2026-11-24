import { notFound } from 'next/navigation';
import { Card, CardBody, CardHeader, DetailPattern, EmptyState, ErrorState } from '@openapps/ui';
import { ToolNotFoundError } from '@openapps/sdk';
import { DeleteDocumentButton } from '@/components/DeleteDocumentButton';
import { TextLink } from '@/components/TextLink';
import { getDocument, type Chunk, type DocumentDetail } from '@/lib/documents';
import { GetArgs } from '@/lib/schemas';

/**
 * Dokument-Detail mit Abschnitten, dasselbe wie das Tool `documents.get` mit
 * `includeChunks: true`. Die Abschnitte tragen Anker `#abschnitt-<n>`, auf
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
    console.error('[wissen] Dokument:', error);
    failed = true;
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-4 p-4 sm:p-6">
      <TextLink href="/dokumente" className="self-start text-sm">
        ← Alle Dokumente
      </TextLink>
      {failed || document === undefined ? (
        <ErrorState
          title="Das Dokument konnte nicht geladen werden"
          description="Die Datenbank hat nicht geantwortet. Lade die Seite neu."
        />
      ) : (
        <DetailPattern
          title={document.title}
          eyebrow="Dokument"
          actions={<DeleteDocumentButton id={document.id} title={document.title} />}
          sections={[
            {
              title: 'Angaben',
              fields: [
                { label: 'Quelle', value: document.source ?? '—', wide: true },
                { label: 'Zeichen', value: document.charCount.toLocaleString('de-DE') },
                { label: 'Abschnitte', value: document.chunkCount },
                { label: 'Angelegt von', value: document.createdBy },
                {
                  label: 'Angelegt am',
                  value: new Date(document.createdAt).toLocaleString('de-DE'),
                },
                { label: 'Id', value: document.id, wide: true },
              ],
            },
          ]}
        >
          <section aria-labelledby="abschnitte" className="flex min-w-0 flex-col gap-3">
            <h2 id="abschnitte" className="text-lg font-semibold text-fg">
              Abschnitte
            </h2>
            {chunks.length === 0 ? (
              <EmptyState
                title="Noch nicht in Abschnitte zerlegt"
                description="Das Dokument wird beim nächsten Start der App zerlegt. Bis dahin findet die Suche es nicht."
              />
            ) : (
              <ol className="flex min-w-0 flex-col gap-3">
                {chunks.map((chunk) => (
                  <li key={chunk.id} id={`abschnitt-${chunk.ord + 1}`} className="scroll-mt-4">
                    <Card>
                      <CardHeader as="h3" title={`Abschnitt ${chunk.ord + 1}`} />
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
    </main>
  );
}
