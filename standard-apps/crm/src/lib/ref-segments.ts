import { splitRefTokens } from '@openapps/app-manifest/refs';
import type { RefTextSegment } from '@openapps/ui';

/**
 * Gespeicherter Text als Abschnitte fuer `RefText`: Klartext und Verweise
 * `@{…}` (ADR 0023). Aus dem Manifest-Paket, nicht aus dem SDK, weil auch
 * Client-Komponenten es brauchen und das SDK den Datenbanktreiber mitbringt.
 */
export function refSegments(text: string): RefTextSegment[] {
  return splitRefTokens(text).map((segment) =>
    segment.kind === 'text' ? { text: segment.text } : { ref: segment.ref.ref },
  );
}
