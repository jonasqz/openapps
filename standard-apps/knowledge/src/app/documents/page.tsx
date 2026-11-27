import type { ReactNode } from 'react';
import { PageHeader, Table } from '@openapps/ui';
import { SourceLink } from '@/components/SourceLink';
import { TextLink } from '@/components/TextLink';
import { listDocuments, type DocumentSummary } from '@/lib/documents';
import { currentViewer, sourceAppDisplay, type Viewer } from '@/lib/viewer';

/**
 * Die Dokumentliste, dasselbe wie das Tool `documents.list`. Leerer und
 * Fehlerzustand kommen ueber `empty` und `error` der Tabelle. Dokumente aus
 * anderen Apps erscheinen nur, wenn der Betrachter die App lesen darf
 * (ADR 0020), und tragen ihre Herkunft mit Link zurueck.
 *
 * Server-Komponente: jede Spalte nennt ihr `field`, die Zelle wird vorher in
 * die Zeile gerechnet (`toRow`) — auch der Verweis, als fertiges Element.
 */
export const dynamic = 'force-dynamic';

interface DocumentRow {
  id: string;
  title: ReactNode;
  source: ReactNode;
  sections: number;
  created: string;
}

const sourceCell = (document: DocumentSummary, viewer: Viewer): ReactNode => {
  if (document.sourceApp === null) return document.source ?? '—';
  return (
    <span className="flex flex-col gap-0.5">
      <SourceLink {...sourceAppDisplay(viewer, document.sourceApp, document.sourcePath)} />
      {document.source === null ? null : (
        <span className="text-xs text-fg-muted [overflow-wrap:anywhere]">{document.source}</span>
      )}
    </span>
  );
};

const toRow = (document: DocumentSummary, viewer: Viewer): DocumentRow => ({
  id: document.id,
  title: <TextLink href={`/documents/${document.id}`}>{document.title}</TextLink>,
  source: sourceCell(document, viewer),
  sections: document.chunkCount,
  created: new Date(document.createdAt).toLocaleDateString('en-GB'),
});

export default async function DocumentsPage() {
  const viewer = await currentViewer();
  let documents: DocumentSummary[] = [];
  let failed = false;
  try {
    documents = await listDocuments({}, viewer.visibility);
  } catch (error) {
    console.error('[knowledge] document list:', error);
    failed = true;
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6">
      <PageHeader
        className="mb-0"
        eyebrow="Knowledge"
        title="Documents"
        description="Everything the search knows that you can see, including content from other apps. Newest first."
        actions={
          <TextLink href="/documents/new" className="shrink-0 self-start text-sm">
            Add document
          </TextLink>
        }
      />

      <Table<DocumentRow>
        caption="Documents"
        searchable
        rows={failed ? [] : documents.map((document) => toRow(document, viewer))}
        columns={[
          { field: 'title', header: 'Title' },
          { field: 'source', header: 'Source', hideBelow: 'md' },
          { field: 'sections', header: 'Sections', align: 'right', hideBelow: 'sm' },
          { field: 'created', header: 'Created', hideBelow: 'sm' },
        ]}
        empty={{
          title: 'No documents yet',
          description: 'Add the first document so the search can find it.',
        }}
        error={
          failed
            ? {
                title: 'Documents could not be loaded',
                description: 'The database did not respond. Reload the page.',
              }
            : undefined
        }
      />
    </div>
  );
}
