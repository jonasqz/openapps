import { ToolNotFoundError } from '@openapps/sdk';
import { getPage, listPages, type Page } from './pages';
import { PageId } from './schemas';

export type Loaded<T> = { kind: 'ok'; value: T } | { kind: 'missing' } | { kind: 'failed' };

/**
 * Laedt eine Seite fuer einen Screen. Eine kaputte Id ist „gibt es nicht“,
 * kein Datenbankfehler — die Datenbank sieht sie nie.
 */
export async function loadPage(rawId: string): Promise<Loaded<Page>> {
  const id = PageId.safeParse(rawId);
  if (!id.success) return { kind: 'missing' };
  try {
    return { kind: 'ok', value: await getPage({ id: id.data }) };
  } catch (error) {
    if (error instanceof ToolNotFoundError) return { kind: 'missing' };
    console.error('[wiki] load page:', error);
    return { kind: 'failed' };
  }
}

/**
 * Seiten fuer „Link to page“ im Editor, nach Titel. `null`, wenn sie nicht
 * geladen werden konnten — der Editor bleibt dann benutzbar, nur ohne Auswahl.
 */
export async function loadLinkTargets(
  excludeId?: string,
): Promise<Array<{ id: string; title: string }> | null> {
  try {
    const { pages } = await listPages({});
    return pages.filter((page) => page.id !== excludeId).map((page) => ({ id: page.id, title: page.title }));
  } catch (error) {
    console.error('[wiki] link targets:', error);
    return null;
  }
}
