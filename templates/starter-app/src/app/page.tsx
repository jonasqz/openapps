import { EmptyState, ErrorState, Table } from '@openapps/ui';
import { listItems } from '@/lib/items';

/**
 * Die Liste. Beide Zustände sind Pflicht: leer und Fehler — der UI-Linter
 * blockiert eine Liste ohne sie.
 */
export default async function ItemsPage() {
  let items;
  try {
    items = await listItems();
  } catch (error) {
    return (
      <ErrorState
        title="Einträge konnten nicht geladen werden"
        description="Die Datenbank hat nicht geantwortet. Lade die Seite neu."
        error={error}
      />
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="Noch keine Einträge"
        description="Lege den ersten Eintrag an, dann erscheint er hier."
      />
    );
  }

  return (
    <Table
      caption="Einträge"
      columns={[
        { key: 'title', header: 'Titel' },
        { key: 'createdAt', header: 'Angelegt' },
      ]}
      rows={items}
    />
  );
}
