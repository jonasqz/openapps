import { MAX_VALUE_CENTS } from './domain';

/**
 * Anzeige und Eingabe im deutschen Format. Zeitzone fest Europe/Berlin, damit
 * Server und Browser dasselbe zeigen, egal wo der Container laeuft.
 */

const EURO = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const DATE = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
const DATE_TIME = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** 1250050 -> "12.500,50 €" (mit geschuetztem Leerzeichen vor dem €). */
export function formatEuro(cents: number): string {
  return EURO.format(cents / 100);
}

/** "2025-03-01" -> "01.03.2025". Ein Kalenderdatum, ohne Zeitzonenverschiebung. */
export function formatDate(isoDate: string | null): string {
  if (isoDate === null) return '–';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (match === null) return isoDate;
  return `${match[3]}.${match[2]}.${match[1]}`;
}

/** ISO-Zeitpunkt -> "01.03.2025, 09:30" in Berliner Zeit. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : DATE_TIME.format(date);
}

/** ISO-Zeitpunkt -> "01.03.2025" in Berliner Zeit. */
export function formatDay(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : DATE.format(date);
}

/**
 * Betrag aus einem Formular in Cent. Deutsches Format: Punkt trennt Tausender,
 * Komma die Cent. `12.500`, `12500`, `12.500,5` und `12500,50 €` gehen;
 * `12.50` nicht — das ist im deutschen Format kein eindeutiger Betrag, und
 * ein falsch gelesener Betrag ist schlimmer als eine Rueckfrage.
 *
 * @returns Cent oder `null`, wenn der Text kein Betrag ist.
 */
export function parseEuroToCents(input: string): number | null {
  const text = input.replace(/€/g, '').replace(/[\s ]/g, '');
  const match = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(text);
  if (match === null) return null;
  const euros = (match[1] ?? '').replace(/\./g, '');
  const cents = (match[2] ?? '').padEnd(2, '0');
  const value = BigInt(euros) * 100n + BigInt(cents);
  if (value > BigInt(MAX_VALUE_CENTS)) return null;
  return Number(value);
}
