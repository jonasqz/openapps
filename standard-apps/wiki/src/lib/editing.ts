/**
 * Bearbeitungsschritte des Markdown-Editors, ohne DOM: Text und Auswahl rein,
 * Text und neue Auswahl raus. So sind sie ohne Browser testbar, und der
 * Editor setzt nur noch den Text und die Auswahl.
 */

export interface Edit {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

/** Bloecke, die eine Zeile mit einem Praefix beginnen. */
export type LineBlock = 'heading' | 'bullet' | 'numbered' | 'checklist' | 'quote';

const PREFIX: Record<LineBlock, string> = {
  heading: '## ',
  bullet: '- ',
  numbered: '1. ',
  checklist: '- [ ] ',
  quote: '> ',
};

/**
 * Erkennt ein bestehendes Block-Praefix am Zeilenanfang, damit ein Wechsel
 * (Liste -> Checkliste) das alte ersetzt statt zwei zu stapeln.
 */
const ANY_PREFIX = /^(#{1,6} |- \[[ xX]\] |[-*+] |\d{1,9}[.)] |> )/;

const clamp = (value: number, max: number): number => Math.max(0, Math.min(value, max));

/**
 * Setzt oder entfernt ein Zeilen-Praefix fuer alle Zeilen der Auswahl. Haben
 * schon alle Zeilen genau dieses Praefix, wird es entfernt (Umschalten).
 */
export function toggleLineBlock(text: string, start: number, end: number, kind: LineBlock): Edit {
  const from = clamp(Math.min(start, end), text.length);
  const to = clamp(Math.max(start, end), text.length);
  const lineStart = text.lastIndexOf('\n', from - 1) + 1;
  const nextBreak = text.indexOf('\n', to);
  const lineEnd = nextBreak === -1 ? text.length : nextBreak;

  const prefix = PREFIX[kind];
  const lines = text.slice(lineStart, lineEnd).split('\n');
  const allHave = lines.every((line) => line.startsWith(prefix));
  const changed = lines.map((line) => {
    if (allHave) return line.slice(prefix.length);
    return prefix + line.replace(ANY_PREFIX, '');
  });

  const replaced = changed.join('\n');
  const next = text.slice(0, lineStart) + replaced + text.slice(lineEnd);
  // Bei einer leeren Zeile steht der Cursor hinter dem Praefix, bereit zum Tippen.
  if (from === to && lines.length === 1) {
    const cursor = lineStart + replaced.length;
    return { text: next, selectionStart: cursor, selectionEnd: cursor };
  }
  return { text: next, selectionStart: lineStart, selectionEnd: lineStart + replaced.length };
}

/**
 * Setzt einen Code-Block um die Auswahl, auf eigenen Zeilen. Ohne Auswahl
 * steht der Cursor im leeren Block.
 */
export function insertCodeBlock(text: string, start: number, end: number): Edit {
  const from = clamp(Math.min(start, end), text.length);
  const to = clamp(Math.max(start, end), text.length);
  const before = text.slice(0, from);
  const selected = text.slice(from, to);
  const after = text.slice(to);
  const lead = before === '' || before.endsWith('\n') ? '' : '\n';
  const trail = after === '' || after.startsWith('\n') ? '' : '\n';
  const open = `${lead}\`\`\`\n`;
  const block = `${open}${selected}\n\`\`\`${trail}`;
  const innerStart = from + open.length;
  return {
    text: before + block + after,
    selectionStart: innerStart,
    selectionEnd: innerStart + selected.length,
  };
}

/** Umschliesst die Auswahl mit einer Inline-Markierung (`**`, `*`, `` ` ``). */
export function wrapInline(text: string, start: number, end: number, marker: string): Edit {
  const from = clamp(Math.min(start, end), text.length);
  const to = clamp(Math.max(start, end), text.length);
  const selected = text.slice(from, to);
  const next = text.slice(0, from) + marker + selected + marker + text.slice(to);
  return {
    text: next,
    selectionStart: from + marker.length,
    selectionEnd: from + marker.length + selected.length,
  };
}

/** Fuegt Text an der Auswahl ein (ersetzt sie); der Cursor steht dahinter. */
export function insertAt(text: string, start: number, end: number, insert: string): Edit {
  const from = clamp(Math.min(start, end), text.length);
  const to = clamp(Math.max(start, end), text.length);
  const cursor = from + insert.length;
  return { text: text.slice(0, from) + insert + text.slice(to), selectionStart: cursor, selectionEnd: cursor };
}

/**
 * Markdown fuer einen Link auf eine Wiki-Seite. Der Parser nimmt keine
 * Beschriftung mit `[` an (zweideutig), also werden eckige Klammern im Titel
 * zu runden. Hervorhebungszeichen werden maskiert, damit der Titel so
 * erscheint, wie er heisst.
 */
export function pageLinkMarkdown(page: { id: string; title: string }): string {
  const label = page.title
    .replace(/\[/g, '(')
    .replace(/\]/g, ')')
    .replace(/[\\`*_]/g, (char) => `\\${char}`);
  return `[${label}](page:${page.id})`;
}
