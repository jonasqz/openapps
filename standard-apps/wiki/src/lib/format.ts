/**
 * Datum fuer die Anzeige. Feste Zeitzone und Sprache, damit Server und
 * Browser dasselbe zeigen — die Seiten rendern auf dem Server.
 */
const DATE_TIME = new Intl.DateTimeFormat('de-DE', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Europe/Berlin',
});

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : DATE_TIME.format(date);
}

export const CHANGE_LABEL = {
  create: 'Angelegt',
  update: 'Bearbeitet',
  archive: 'Archiviert',
} as const;
