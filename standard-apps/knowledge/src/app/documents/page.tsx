import type { ReactNode } from 'react';
import { Table } from '@openapps/ui';
import { TextLink } from '@/components/TextLink';
import { listDocuments, type DocumentSummary } from '@/lib/documents';

/**
 * Die Dokumentliste, dasselbe wie das Tool `documents.list`. Leerer und
 * Fehlerzustand kommen ueber `empty` und `error` der Tabelle.
 *
 * Server-Komponente: jede Spalte nennt ihr `field`, die Zelle wird vorher in
 * die Zeile gerechnet (`toRow`) — auch der Verweis, als fertiges Element.
 */
export const dynamic = 'force-dynamic';

interface DocumentRow {
  id: string;
  title: ReactNode;
  source: string;
  sections: number;
  created: string;
}

const toRow = (document: DocumentSummary): DocumentRow => ({
  id: document.id,
  title: <TextLink href={`/documents/${document.id}`}>{document.title}</TextLink>,
  source: document.source ?? '—',
  sections: document.chunkCount,
  created: new Date(document.createdAt).toLocaleDateString('en-GB'),
});

export default async function DocumentsPage() {
  let documents: DocumentSummary[] = [];
  let failed = false;
  try {
    documents = await listDocuments();
  } catch (error) {
    console.error('[knowledge] document list:', error);
    failed = true;
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-fg">Documents</h1>
          <p className="mt-1 text-sm text-fg-muted">
            Everything the search knows. Newest first.
          </p>
        </div>
        <TextLink href="/documents/new" className="shrink-0 self-start text-sm">
          Add document
        </TextLink>
      </header>

      <Table<DocumentRow>
        caption="Documents"
        rows={failed ? [] : documents.map(toRow)}
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
