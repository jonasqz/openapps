import { ToolNotFoundError } from '@openapps/sdk';
import { getPage, type Page } from './pages';
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
