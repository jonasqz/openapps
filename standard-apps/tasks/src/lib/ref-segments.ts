import { splitRefTokens } from '@openapps/sdk';
import type { RefTextSegment } from '@openapps/ui';

/** Gespeicherter Text als Abschnitte fuer `RefText`: Klartext und Verweise (ADR 0023). */
export function refSegments(text: string): RefTextSegment[] {
  return splitRefTokens(text).map((segment) =>
    segment.kind === 'text' ? { text: segment.text } : { ref: segment.ref.ref },
  );
}
