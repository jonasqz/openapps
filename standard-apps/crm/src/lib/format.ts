import { MAX_VALUE_CENTS } from './domain';

/**
 * Anzeige und Eingabe im britischen Format (en-GB, ADR 0016). Waehrung bleibt
 * Euro. Zeitzone fest Europe/Berlin, damit Server und Browser dasselbe zeigen,
 * egal wo der Container laeuft.
 */

const EURO = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR' });
const DATE_OPTIONS = { day: 'numeric', month: 'short', year: 'numeric' } as const;
/** Kalenderdatum ohne Uhrzeit: in UTC formatiert, damit sich der Tag nicht verschiebt. */
const CALENDAR_DATE = new Intl.DateTimeFormat('en-GB', { ...DATE_OPTIONS, timeZone: 'UTC' });
const DATE = new Intl.DateTimeFormat('en-GB', { ...DATE_OPTIONS, timeZone: 'Europe/Berlin' });
const DATE_TIME = new Intl.DateTimeFormat('en-GB', {
  ...DATE_OPTIONS,
  timeZone: 'Europe/Berlin',
  hour: '2-digit',
  minute: '2-digit',
});

/** 1250050 -> "€12,500.50". */
export function formatEuro(cents: number): string {
  return EURO.format(cents / 100);
}

/** "2025-03-01" -> "1 Mar 2025". Ein Kalenderdatum, ohne Zeitzonenverschiebung. */
export function formatDate(isoDate: string | null): string {
  if (isoDate === null) return '–';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (match === null) return isoDate;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? isoDate : CALENDAR_DATE.format(date);
}

/** ISO-Zeitpunkt -> "1 Mar 2025, 09:30" in Berliner Zeit. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : DATE_TIME.format(date);
}

/** ISO-Zeitpunkt -> "1 Mar 2025" in Berliner Zeit. */
export function formatDay(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : DATE.format(date);
}

/**
 * Betrag aus einem Formular in Cent. Englisches Format: Komma trennt
 * Tausender, Punkt die Cent. `12,500`, `12500`, `12500.5` und `€12,500.50`
 * gehen. Abgewiesen werden die typischen deutschen Eingaben `12.500` (drei
 * Stellen nach dem Punkt) und `12,50` (Komma ohne volle Tausendergruppe) —
 * ein falsch gelesener Betrag ist schlimmer als eine Rueckfrage.
 *
 * @returns Cent oder `null`, wenn der Text kein Betrag ist.
 */
export function parseEuroToCents(input: string): number | null {
  const text = input.replace(/€/g, '').replace(/\s/g, '');
  const match = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (match === null) return null;
  const euros = (match[1] ?? '').replace(/,/g, '');
  const cents = (match[2] ?? '').padEnd(2, '0');
  const value = BigInt(euros) * 100n + BigInt(cents);
  if (value > BigInt(MAX_VALUE_CENTS)) return null;
  return Number(value);
}
