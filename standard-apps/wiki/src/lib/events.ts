import { actorOf, createEventOutbox, EVENT_LIMITS, recipientOf, type PlatformEventInput } from '@openapps/sdk';
import { query, type Tx } from './db';

/**
 * Was das Wiki der Plattform meldet (ADR 0022), so wie es in `app.json`
 * unter `events` steht: `page.updated` an alle, die die Seite als Favorit
 * haben, wenn sich Titel, Inhalt oder Tags aendern (bearbeitet oder auf eine
 * fruehere Fassung zurueckgesetzt).
 *
 * Wer davon eine Benachrichtigung bekommt, entscheidet die Plattform: nur,
 * wer das Wiki lesen darf, und nie, wer geaendert hat. Hier steht kein
 * Rechte-Code. Geliefert wird nach dem Commit (`kickEvents`), getrennt von
 * der Lieferung an die Suche.
 */

export const WIKI_EVENT_TYPES = ['page.updated'] as const;

export const wikiEvents = createEventOutbox({
  query: (sql, params) => query(sql, params),
  name: '[wiki] events',
});

/** Nach dem Commit: liefern, ohne zu warten. Wirft nie. */
export function kickEvents(): void {
  wikiEvents.kick();
}

/**
 * Die Ereignisse zu einer Aenderung: eines je 50 Favoriten (mehr nimmt die
 * Plattform je Ereignis nicht an). `revisionId` macht die Id eindeutig.
 */
export function pageUpdatedEvents(
  page: { id: string; title: string },
  revisionId: string,
  favoritedBy: readonly string[],
  actor: string,
): PlatformEventInput[] {
  const audience = [
    ...new Set(favoritedBy.map((id) => recipientOf(id)).filter((id) => id !== null)),
  ];
  const events: PlatformEventInput[] = [];
  for (let start = 0; start < audience.length; start += EVENT_LIMITS.audience) {
    const part = Math.floor(start / EVENT_LIMITS.audience);
    events.push({
      id: part === 0 ? `page.updated:${revisionId}` : `page.updated:${revisionId}:${String(part)}`,
      type: 'page.updated',
      object: `page:${page.id}`,
      title: `Page changed: ${page.title}`,
      path: `/pages/${page.id}`,
      actor: actorOf(actor),
      audience: audience.slice(start, start + EVENT_LIMITS.audience),
    });
  }
  return events;
}

/** Reiht `page.updated` fuer die Favoriten der Seite ein. Nur in der Transaktion der Aenderung. */
export async function emitPageUpdated(tx: Tx, pageId: string, revisionId: string, actor: string): Promise<void> {
  const [page] = await tx.query<{ id: string; title: string }>('select id, title from pages where id = $1', [pageId]);
  if (page === undefined) return;
  const favorites = await tx.query<{ user_id: string }>(
    'select user_id from page_favorites where page_id = $1 and user_id <> $2 order by created_at',
    [pageId, actor],
  );
  const events = pageUpdatedEvents(page, revisionId, favorites.map((row) => row.user_id), actor);
  if (events.length === 0) return;
  await wikiEvents.emit((sql, params) => tx.query(sql, params), events);
}
