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
  titel: ReactNode;
  quelle: string;
  abschnitte: number;
  angelegt: string;
}

const toRow = (document: DocumentSummary): DocumentRow => ({
  id: document.id,
  titel: <TextLink href={`/dokumente/${document.id}`}>{document.title}</TextLink>,
  quelle: document.source ?? '—',
  abschnitte: document.chunkCount,
  angelegt: new Date(document.createdAt).toLocaleDateString('de-DE'),
});

export default async function DocumentsPage() {
  let documents: DocumentSummary[] = [];
  let failed = false;
  try {
    documents = await listDocuments();
  } catch (error) {
    console.error('[wissen] Dokumentliste:', error);
    failed = true;
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-fg">Dokumente</h1>
          <p className="mt-1 text-sm text-fg-muted">
            Alles, was die Suche kennt. Neueste zuerst.
          </p>
        </div>
        <nav aria-label="Wissen" className="flex shrink-0 flex-wrap gap-4 text-sm">
          <TextLink href="/">Suche</TextLink>
          <TextLink href="/dokumente/neu">Dokument hinzufügen</TextLink>
        </nav>
      </header>

      <Table<DocumentRow>
        caption="Dokumente"
        rows={failed ? [] : documents.map(toRow)}
        columns={[
          { field: 'titel', header: 'Titel' },
          { field: 'quelle', header: 'Quelle', hideBelow: 'md' },
          { field: 'abschnitte', header: 'Abschnitte', align: 'right', hideBelow: 'sm' },
          { field: 'angelegt', header: 'Angelegt', hideBelow: 'sm' },
        ]}
        empty={{
          title: 'Noch keine Dokumente',
          description: 'Füge das erste Dokument hinzu, dann kann die Suche es finden.',
        }}
        error={
          failed
            ? {
                title: 'Dokumente konnten nicht geladen werden',
                description: 'Die Datenbank hat nicht geantwortet. Lade die Seite neu.',
              }
            : undefined
        }
      />
    </main>
  );
}
