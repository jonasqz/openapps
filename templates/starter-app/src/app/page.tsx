import { Table } from '@openapps/ui';
import { listItems, type Item } from '@/lib/items';

/**
 * Die Liste. Leerer und Fehlerzustand sind Pflicht — hier tragen sie die
 * `empty`- und `error`-Props der Tabelle, die beide selbst rendert. Eine Liste
 * ohne diese zwei Zustände blockiert der UI-Linter.
 */
export default async function ItemsPage() {
  let items: Item[] = [];
  let failed = false;

  try {
    items = await listItems();
  } catch {
    failed = true;
  }

  return (
    <main className="p-lg">
      <Table<Item>
        caption="Einträge"
        rows={failed ? [] : items}
        rowKey={(row) => row.id}
        columns={[
          { key: 'title', header: 'Titel', cell: (row) => row.title },
          {
            key: 'createdAt',
            header: 'Angelegt',
            cell: (row) => new Date(row.createdAt).toLocaleDateString('de-DE'),
            hideBelow: 'sm',
          },
        ]}
        empty={{
          title: 'Noch keine Einträge',
          description: 'Lege den ersten Eintrag an, dann erscheint er hier.',
        }}
        error={
          failed
            ? {
                title: 'Einträge konnten nicht geladen werden',
                description: 'Die Datenbank hat nicht geantwortet. Lade die Seite neu.',
              }
            : undefined
        }
      />
    </main>
  );
}
