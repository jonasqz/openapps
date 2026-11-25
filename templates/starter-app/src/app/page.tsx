import { Table } from '@openapps/ui';
import { listItems, type Item } from '@/lib/items';

/**
 * Die Liste. Leerer und Fehlerzustand sind Pflicht — hier tragen sie die
 * `empty`- und `error`-Props der Tabelle, die beide selbst rendert. Eine Liste
 * ohne diese zwei Zustände blockiert der UI-Linter.
 *
 * Diese Seite rendert auf dem Server. Deshalb nennt jede Spalte ihr `field`
 * und keine `cell`: React reicht keine Funktion von einer Server-Komponente in
 * eine Client-Komponente, und `Table` ist eine. Was die Zelle zeigen soll,
 * wird vorher hier ausgerechnet (`created`) und als Feld in die Zeile gelegt.
 */
interface ItemRow {
  id: string;
  title: string;
  created: string;
}

const toRow = (item: Item): ItemRow => ({
  id: item.id,
  title: item.title,
  created: new Date(item.createdAt).toLocaleDateString('en-GB'),
});

/**
 * Immer zur Laufzeit rendern. Ohne diese Zeile rendert Next die Seite schon
 * beim Build, wenn es noch keine Datenbank gibt, und liefert danach fuer
 * immer den Fehlerzustand aus.
 */
export const dynamic = 'force-dynamic';

export default async function ItemsPage() {
  let items: Item[] = [];
  let failed = false;

  try {
    items = await listItems();
  } catch {
    failed = true;
  }

  return (
    <main className="p-6">
      <Table<ItemRow>
        caption="Items"
        rows={failed ? [] : items.map(toRow)}
        columns={[
          { field: 'title', header: 'Title' },
          { field: 'created', header: 'Created', hideBelow: 'sm' },
        ]}
        empty={{
          title: 'No items yet',
          description: 'Create the first item and it appears here.',
        }}
        error={
          failed
            ? {
                title: 'Items could not be loaded',
                description: 'The database did not respond. Reload the page.',
              }
            : undefined
        }
      />
    </main>
  );
}
