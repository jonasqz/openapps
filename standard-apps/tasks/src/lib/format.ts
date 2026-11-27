/**
 * Datumsanzeige ohne Zeitzone und Sprache des Browsers: Seiten rendern auf
 * dem Server und hydrieren im Browser, und ein Format, das von dort abhaengt,
 * ergibt zwei verschiedene Zeichenketten.
 */

/** JJJJ-MM-TT als TT/MM/JJJJ. */
export function formatDate(iso: string | null): string {
  if (iso === null) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match === null ? iso : `${match[3]}/${match[2]}/${match[1]}`;
}

/** ISO-Zeitpunkt als "TT/MM/JJJJ HH:MM UTC". */
export function formatDateTime(iso: string | null): string {
  if (iso === null) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const day = formatDate(date.toISOString().slice(0, 10));
  return `${day} ${date.toISOString().slice(11, 16)} UTC`;
}

/** Heute als JJJJ-MM-TT in UTC. */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
