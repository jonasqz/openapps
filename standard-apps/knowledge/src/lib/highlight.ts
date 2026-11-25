/**
 * Die Suche markiert Treffer im Ausschnitt mit `«` und `»` statt mit HTML
 * (`ts_headline` mit StartSel/StopSel). Hier wird daraus eine Liste von
 * Textstuecken, die die UI als Text und `<mark>` rendert — nie als HTML. Was
 * immer im Dokument steht, auch `<script>`, bleibt damit Text.
 *
 * Damit ein `«` oder `»` aus dem Dokument selbst nicht als Markierung gilt,
 * ersetzt die Suche sie vor `ts_headline` durch `‹` und `›` (retriever.ts).
 * Die Funktion hier ist trotzdem robust gegen unpaarige Zeichen: Ein `»` ohne
 * offenes `«` bleibt Text, ein `«` ohne schliessendes `»` ebenso.
 */

export const MARK_START = '«';
export const MARK_END = '»';

export interface HighlightSegment {
  readonly text: string;
  readonly marked: boolean;
}

export function parseHighlights(excerpt: string): HighlightSegment[] {
  const segments: HighlightSegment[] = [];
  const push = (text: string, marked: boolean): void => {
    if (text === '') return;
    const last = segments[segments.length - 1];
    if (last !== undefined && last.marked === marked) {
      segments[segments.length - 1] = { text: last.text + text, marked };
    } else {
      segments.push({ text, marked });
    }
  };

  let rest = excerpt;
  while (rest !== '') {
    const open = rest.indexOf(MARK_START);
    if (open === -1) {
      push(rest, false);
      break;
    }
    const close = rest.indexOf(MARK_END, open + MARK_START.length);
    if (close === -1) {
      push(rest, false);
      break;
    }
    push(rest.slice(0, open), false);
    const inner = rest.slice(open + MARK_START.length, close);
    // Ein verschachteltes `«` im markierten Teil ist kein Marker, sondern Text.
    push(inner, inner !== '');
    rest = rest.slice(close + MARK_END.length);
  }
  return segments;
}

/** Der Ausschnitt ohne Markierung, z. B. fuer Kopieren oder Vorlesen. */
export function stripHighlights(excerpt: string): string {
  return parseHighlights(excerpt)
    .map((segment) => segment.text)
    .join('');
}
