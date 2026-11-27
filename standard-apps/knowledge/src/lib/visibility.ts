import { APP_HOST_ENV } from '@openapps/sdk';

/**
 * Was ein Aufrufer aus anderen Apps sehen darf (ADR 0020). Knowledge prueft
 * keine Rechte: Die Liste kommt signiert von der Plattform
 * (`getReadableApps` bzw. `ctx.readableApps`). Hier wird sie nur angewendet.
 *
 * - Dokumente ohne Quell-App sind immer sichtbar: Sie gehoeren Knowledge, und
 *   wer Knowledge oeffnen darf, darf sie lesen.
 * - Dokumente mit Quell-App nur, wenn die App in der Liste steht.
 * - Ohne gueltige Liste (`null`) nur Dokumente ohne Quell-App. Kein Fehler:
 *   Die Suche antwortet, nur mit weniger.
 */
export interface Visibility {
  readonly readableApps: readonly string[] | null;
}

/** Nichts aus anderen Apps. Der sichere Ausgangswert. */
export const OWN_DOCUMENTS_ONLY: Visibility = Object.freeze({ readableApps: null });

/** Die Quell-Apps, deren Dokumente sichtbar sind, als Array fuer `= any($n::text[])`. */
export function visibleSourceApps(visibility: Visibility): string[] {
  return visibility.readableApps === null ? [] : [...visibility.readableApps];
}

/**
 * Die Adresse zurueck zur Quelle: dieselbe Domain wie Knowledge (ADR 0007),
 * Pfad der Quell-App, dann der Pfad im Dokument. `null`, wenn es keine
 * Quell-App gibt oder die eigene Domain nicht bekannt ist.
 */
export function sourceUrlFor(
  sourceApp: string | null,
  sourcePath: string | null,
  host: string | undefined = process.env[APP_HOST_ENV],
): string | null {
  if (sourceApp === null) return null;
  const domain = (host ?? '').trim().toLowerCase();
  if (domain === '') return null;
  return `https://${domain}/${sourceApp}${sourcePath ?? ''}`;
}
