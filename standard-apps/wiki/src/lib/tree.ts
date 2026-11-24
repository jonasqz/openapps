import { formatDateTime } from './format';
import type { PageSummary } from './pages';

/** Eine Zeile der Seitenliste, fertig fuer die Anzeige. */
export interface PageRow {
  id: string;
  title: string;
  depth: number;
  tags: string[];
  updatedAt: string;
  /** Nur bei Suchtreffern: Ausschnitt, Treffer in `«…»`. */
  snippet?: string;
}

/** Baum in Lesereihenfolge: Eltern vor Kindern, Geschwister nach Titel. */
export function toTreeRows(pages: readonly PageSummary[]): PageRow[] {
  const ids = new Set(pages.map((page) => page.id));
  const children = new Map<string | null, PageSummary[]>();
  for (const page of pages) {
    // Fehlt die Elternseite in der Liste, steht die Seite oben statt gar nicht.
    const parent = page.parentId !== null && ids.has(page.parentId) ? page.parentId : null;
    const siblings = children.get(parent) ?? [];
    siblings.push(page);
    children.set(parent, siblings);
  }

  const rows: PageRow[] = [];
  const seen = new Set<string>();
  const visit = (parent: string | null, depth: number): void => {
    for (const page of children.get(parent) ?? []) {
      if (seen.has(page.id)) continue;
      seen.add(page.id);
      rows.push({
        id: page.id,
        title: page.title,
        depth,
        tags: page.tags,
        updatedAt: formatDateTime(page.updatedAt),
      });
      visit(page.id, depth + 1);
    }
  };
  visit(null, 0);
  return rows;
}

