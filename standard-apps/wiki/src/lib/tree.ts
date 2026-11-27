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


/** Ein Knoten im Seitenbaum, wie `pages.tree` ihn liefert. */
export interface TreeNode {
  id: string;
  title: string;
  updatedAt: string;
  children: TreeNode[];
}

/** Was `buildTree` von einer Seite braucht. */
export interface TreeSource {
  id: string;
  parentId: string | null;
  title: string;
  updatedAt: string;
}

/**
 * Baut aus einer flachen Liste einen verschachtelten Baum. Geschwister bleiben
 * in der Reihenfolge der Eingabe (die Datenbank sortiert nach Titel).
 *
 * Mit `rootId`: genau ein Knoten, die Wurzel mit ihren Nachfahren (leer, wenn
 * die Wurzel fehlt). Ohne: alle Seiten ohne Elternseite in der Liste — fehlt
 * die Elternseite (abgeschnittene Liste), steht die Seite oben statt gar nicht.
 *
 * Kreisfest: Jede Seite erscheint hoechstens einmal.
 */
export function buildTree(pages: readonly TreeSource[], rootId?: string): TreeNode[] {
  const ids = new Set(pages.map((page) => page.id));
  const children = new Map<string | null, TreeSource[]>();
  for (const page of pages) {
    const parent =
      page.id === rootId ? null : page.parentId !== null && ids.has(page.parentId) ? page.parentId : null;
    const siblings = children.get(parent) ?? [];
    siblings.push(page);
    children.set(parent, siblings);
  }

  const seen = new Set<string>();
  const visit = (page: TreeSource): TreeNode => {
    seen.add(page.id);
    const kids: TreeNode[] = [];
    for (const child of children.get(page.id) ?? []) {
      if (!seen.has(child.id)) kids.push(visit(child));
    }
    return { id: page.id, title: page.title, updatedAt: page.updatedAt, children: kids };
  };

  if (rootId !== undefined) {
    const root = pages.find((page) => page.id === rootId);
    return root === undefined ? [] : [visit(root)];
  }
  const roots: TreeNode[] = [];
  for (const page of children.get(null) ?? []) {
    if (!seen.has(page.id)) roots.push(visit(page));
  }
  return roots;
}

/** Zahl der Knoten in einem Baum. */
export function countNodes(nodes: readonly TreeNode[]): number {
  return nodes.reduce((sum, node) => sum + 1 + countNodes(node.children), 0);
}

/** Ein Knoten flach, mit Tiefe — fuer Auswahllisten. */
export interface FlatNode {
  id: string;
  title: string;
  depth: number;
}

/**
 * Baum in Lesereihenfolge, flach. `exclude` laesst eine Seite samt allen
 * Unterseiten weg: Beim Verschieben sind genau das die Ziele, die einen Kreis
 * ergaeben. Die Datenbank prueft es beim Verschieben trotzdem noch einmal.
 */
export function flattenTree(nodes: readonly TreeNode[], exclude?: string): FlatNode[] {
  const out: FlatNode[] = [];
  const seen = new Set<string>();
  const visit = (list: readonly TreeNode[], depth: number): void => {
    for (const node of list) {
      if (node.id === exclude || seen.has(node.id)) continue;
      seen.add(node.id);
      out.push({ id: node.id, title: node.title, depth });
      visit(node.children, depth + 1);
    }
  };
  visit(nodes, 0);
  return out;
}
