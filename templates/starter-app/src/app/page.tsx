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
 * wird vorher hier ausgerechnet (`angelegt`) und als Feld in die Zeile gelegt.
 */
interface ItemRow {
  id: string;
  title: string;
  angelegt: string;
}

const toRow = (item: Item): ItemRow => ({
  id: item.id,
  title: item.title,
  angelegt: new Date(item.createdAt).toLocaleDateString('de-DE'),
});

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
      <Table<ItemRow>
        caption="Einträge"
        rows={failed ? [] : items.map(toRow)}
        columns={[
          { field: 'title', header: 'Titel' },
          { field: 'angelegt', header: 'Angelegt', hideBelow: 'sm' },
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
