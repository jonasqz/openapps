/**
 * Ein kleiner Markdown-Parser fuer Wiki-Seiten.
 *
 * Er erzeugt einen Baum aus einfachen Objekten, den `Markdown.tsx` als React
 * rendert. Es entsteht nie HTML als Zeichenkette und nie
 * `dangerouslySetInnerHTML` — HTML im Markdown bleibt Text, weil React jeden
 * Text escapet.
 *
 * Unterstuetzt: Ueberschriften (`#` bis `######`), Absaetze, Listen (`-`, `*`,
 * `+`, `1.`), Checklisten (`- [ ]`, `- [x]`), Zitate (`>`), Trennlinien,
 * Code-Bloecke (```), Inline-Code, Fett (`**`), Kursiv (`*`, `_`), Links
 * `[Text](URL)`, Links auf andere Wiki-Seiten `[Text](page:<uuid>)` und
 * Verweise auf Objekte anderer Apps und Personen `@{app:typ:id}` (ADR 0023).
 * Ein Verweis traegt nur den geprueften Verweis weiter, nie einen Titel; den
 * laedt der Chip im Browser ueber die Plattform.
 *
 * Links nur mit http(s) oder als `page:` mit einer UUID. Alles andere
 * (`javascript:`, `data:`, relative Pfade, `//host`) wird als Text gezeigt,
 * nicht als Link. Ein Seitenlink traegt nur die geprueften UUID weiter, nie die
 * rohe Zeichenkette — der Renderer baut den Pfad selbst.
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: Inline[] }
  | { type: 'pagelink'; id: string; children: Inline[] }
  | { type: 'ref'; ref: string };

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; children: Inline[] }
  | { type: 'paragraph'; children: Inline[] }
  | {
      type: 'list';
      ordered: boolean;
      start: number;
      items: Inline[][];
      /** Je Punkt: `null` ohne Kaestchen, sonst ob abgehakt (`- [x]`). */
      checked: Array<boolean | null>;
    }
  | { type: 'quote'; children: Inline[] }
  | { type: 'code'; lang: string; text: string }
  | { type: 'hr' };

import { parseRef } from '@openapps/app-manifest/refs';

/** Tiefe, ab der verschachtelte Hervorhebungen als Text bleiben. */
const MAX_INLINE_DEPTH = 8;

/**
 * Gibt die URL zurueck, wenn sie ein absoluter http(s)-Link ist, sonst
 * `undefined`. Steuerzeichen und Leerraum in der URL machen sie ungueltig —
 * Browser entfernen sie stillschweigend (`java\tscript:`), also wird hier
 * nicht geraten.
 */
export function safeHref(raw: string): string | undefined {
  const candidate = raw.trim();
  if (candidate === '' || /[\u0000- \u007f-\u009f]/.test(candidate)) return undefined;
  if (!/^https?:\/\//i.test(candidate)) return undefined;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  if (url.hostname === '') return undefined;
  return url.href;
}

/** `page:` plus UUID, gross oder klein geschrieben. */
const PAGE_LINK = /^page:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * Gibt die Seiten-Id zurueck, wenn die URL ein Wiki-Seitenlink ist
 * (`page:<uuid>`), sonst `undefined`. Immer klein geschrieben, damit dieselbe
 * Seite nicht zweimal als Rueckverweis zaehlt.
 */
export function pageLinkId(raw: string): string | undefined {
  const match = PAGE_LINK.exec(raw.trim());
  return match?.[1]?.toLowerCase();
}

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*#*[ \t]*$/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}>[ \t]?(.*)$/;
const BULLET = /^ {0,3}[-*+][ \t]+(.*)$/;
const ORDERED = /^ {0,3}(\d{1,9})[.)][ \t]+(.*)$/;
/** Kaestchen am Anfang eines Listenpunkts: `[ ]` offen, `[x]` erledigt. */
const TASK = /^\[([ xX])\](?:[ \t]+(.*))?$/;

const isBlank = (line: string): boolean => line.trim() === '';

/** Beginnt mit dieser Zeile ein neuer Block (und endet damit ein Absatz)? */
function startsBlock(line: string): boolean {
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    HR.test(line) ||
    QUOTE.test(line) ||
    BULLET.test(line) ||
    ORDERED.test(line)
  );
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';

    if (isBlank(line)) {
      i += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence !== null) {
      const marker = fence[1] ?? '```';
      const body: string[] = [];
      i += 1;
      while (i < lines.length) {
        const inner = lines[i] ?? '';
        const trimmed = inner.trim();
        if (trimmed.length >= marker.length && trimmed === marker.charAt(0).repeat(trimmed.length)) {
          i += 1;
          break;
        }
        body.push(inner);
        i += 1;
      }
      blocks.push({ type: 'code', lang: fence[2] ?? '', text: body.join('\n') });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading !== null) {
      const level = (heading[1] ?? '#').length as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({ type: 'heading', level, children: parseInline(heading[2] ?? '') });
      i += 1;
      continue;
    }

    if (HR.test(line)) {
      blocks.push({ type: 'hr' });
      i += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const parts: string[] = [];
      while (i < lines.length) {
        const match = QUOTE.exec(lines[i] ?? '');
        if (match === null) break;
        parts.push((match[1] ?? '').trim());
        i += 1;
      }
      blocks.push({ type: 'quote', children: parseInline(parts.filter((p) => p !== '').join(' ')) });
      continue;
    }

    const bullet = BULLET.exec(line);
    const ordered = bullet === null ? ORDERED.exec(line) : null;
    if (bullet !== null || ordered !== null) {
      const isOrdered = ordered !== null;
      const pattern = isOrdered ? ORDERED : BULLET;
      const start = ordered !== null ? Number(ordered[1]) : 1;
      const items: string[][] = [];
      while (i < lines.length) {
        const current = lines[i] ?? '';
        if (isBlank(current)) break;
        const item = pattern.exec(current);
        if (item !== null) {
          items.push([(isOrdered ? item[2] : item[1]) ?? '']);
          i += 1;
          continue;
        }
        // Fortsetzungszeile: eingerueckt oder einfach weiterlaufender Text,
        // solange sie keinen anderen Block beginnt.
        if (startsBlock(current)) break;
        items[items.length - 1]?.push(current.trim());
        i += 1;
      }
      const texts = items.map((parts) => parts.join(' ').trim());
      const checked = texts.map((text) => {
        const task = TASK.exec(text);
        return task === null ? null : (task[1] ?? ' ') !== ' ';
      });
      blocks.push({
        type: 'list',
        ordered: isOrdered,
        start,
        items: texts.map((text, index) =>
          parseInline(checked[index] === null ? text : (TASK.exec(text)?.[2] ?? '')),
        ),
        checked,
      });
      continue;
    }

    const parts: string[] = [];
    while (i < lines.length) {
      const current = lines[i] ?? '';
      if (isBlank(current)) break;
      if (parts.length > 0 && startsBlock(current)) break;
      parts.push(current.trim());
      i += 1;
    }
    blocks.push({ type: 'paragraph', children: parseInline(parts.join(' ')) });
  }

  return blocks;
}

/**
 * Inline-Parser. Laeuft von links nach rechts; ein Oeffner ohne Schliesser
 * bleibt Text.
 *
 * `noClose` merkt sich je Markierung die Stelle, ab der es keinen Schliesser
 * mehr gibt. Ohne das wird ein Absatz aus tausenden `**` quadratisch teuer —
 * und der Renderer laeuft auf dem Server, also waere das ein Weg, ihn zu
 * blockieren.
 */
export function parseInline(text: string): Inline[] {
  return parseInlineAt(text, 0, new Map());
}

function parseInlineAt(text: string, depth: number, noClose: Map<string, number>): Inline[] {
  const out: Inline[] = [];
  let buffer = '';

  const flush = (): void => {
    if (buffer !== '') {
      const last = out[out.length - 1];
      if (last !== undefined && last.type === 'text') last.text += buffer;
      else out.push({ type: 'text', text: buffer });
      buffer = '';
    }
  };

  /**
   * Fuehrt `search` aus, ausser es ist schon bekannt, dass es ab einer
   * frueheren Stelle keinen Schliesser gab — dann gibt es auch ab `from` keinen.
   */
  const findCached = (key: string, from: number, search: () => number): number => {
    const known = noClose.get(key);
    if (known !== undefined && from >= known) return -1;
    const index = search();
    if (index === -1) noClose.set(key, Math.min(known ?? from, from));
    return index;
  };

  const findClose = (marker: string, from: number): number =>
    findCached(marker, from, () => text.indexOf(marker, from));

  let i = 0;
  while (i < text.length) {
    const char = text[i] ?? '';

    if (char === '\\' && i + 1 < text.length && /[\\`*_[\]()#>+\-.!]/.test(text[i + 1] ?? '')) {
      buffer += text[i + 1];
      i += 2;
      continue;
    }

    if (char === '`') {
      const close = findClose('`', i + 1);
      if (close > i + 1) {
        flush();
        out.push({ type: 'code', text: text.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
    }

    if (depth < MAX_INLINE_DEPTH && text.startsWith('**', i)) {
      let close = findClose('**', i + 2);
      // `**fett *kursiv***`: Das erste `**` im `***` schliesst sonst zu frueh
      // und laesst das innere `*` offen. Ist innen ein `*` offen, gehoert das
      // erste Sternchen ihm.
      if (close !== -1 && text[close + 2] === '*' && countChar(text, '*', i + 2, close) % 2 === 1) {
        close += 1;
      }
      if (close > i + 2) {
        flush();
        out.push({
          type: 'strong',
          children: parseInlineAt(text.slice(i + 2, close), depth + 1, new Map()),
        });
        i = close + 2;
        continue;
      }
    }

    if (depth < MAX_INLINE_DEPTH && (char === '*' || char === '_')) {
      const before = i === 0 ? '' : (text[i - 1] ?? '');
      const after = text[i + 1] ?? '';
      // `_` mitten im Wort (snake_case) ist kein Kursiv. Ein Oeffner braucht
      // direkt danach ein Nicht-Leerzeichen.
      const opens = after !== '' && !/\s/.test(after) && !(char === '_' && /[\p{L}\p{N}]/u.test(before));
      if (opens) {
        const close = findCached(`single${char}`, i + 1, () => findSingleClose(text, char, i + 1));
        if (close > i + 1) {
          flush();
          out.push({
            type: 'em',
            children: parseInlineAt(text.slice(i + 1, close), depth + 1, new Map()),
          });
          i = close + 1;
          continue;
        }
      }
    }

    if (char === '@' && text[i + 1] === '{') {
      const close = findClose('}', i + 2);
      const token = close === -1 ? '' : text.slice(i + 2, close);
      const parsed = token === '' || /[\s{]/.test(token) ? null : parseRef(token);
      if (parsed !== null) {
        flush();
        out.push({ type: 'ref', ref: parsed.ref });
        i = close + 1;
        continue;
      }
    }

    if (char === '[' && depth < MAX_INLINE_DEPTH) {
      const link = readLink(text, i, findClose);
      if (link !== undefined) {
        flush();
        const label = parseInlineAt(link.label, depth + 1, new Map());
        const pageId = pageLinkId(link.url);
        const href = pageId === undefined ? safeHref(link.url) : undefined;
        if (pageId !== undefined) {
          out.push({ type: 'pagelink', id: pageId, children: label });
        } else if (href === undefined) {
          // Kein sicherer Link: Beschriftung bleibt sichtbar, die URL nicht
          // klickbar. So geht kein Inhalt verloren, aber nichts wird ausgefuehrt.
          out.push(...label);
        } else {
          out.push({ type: 'link', href, children: label });
        }
        i = link.end;
        continue;
      }
    }

    buffer += char;
    i += 1;
  }

  flush();
  return out;
}

function countChar(text: string, char: string, from: number, to: number): number {
  let count = 0;
  for (let j = from; j < to; j += 1) if (text[j] === char) count += 1;
  return count;
}

/**
 * Schliesser fuer einfaches `*`/`_`: nicht direkt nach Leerraum, und bei `*`
 * nicht Teil eines `**`. Linear, ohne Rueckschritt.
 */
function findSingleClose(text: string, marker: string, from: number): number {
  for (let j = from; j < text.length; j += 1) {
    const char = text[j];
    if (char === '\\') {
      j += 1;
      continue;
    }
    if (char !== marker) continue;
    if (marker === '*' && text[j + 1] === '*') {
      j += 1;
      continue;
    }
    if (/\s/.test(text[j - 1] ?? '')) continue;
    if (marker === '_' && /[\p{L}\p{N}]/u.test(text[j + 1] ?? '')) continue;
    return j;
  }
  return -1;
}

/** `[Beschriftung](url)` ab `start`. Ohne schliessende Klammern: kein Link. */
function readLink(
  text: string,
  start: number,
  findClose: (marker: string, from: number) => number,
): { label: string; url: string; end: number } | undefined {
  const middle = findClose('](', start + 1);
  if (middle === -1) return undefined;
  const label = text.slice(start + 1, middle);
  // Eine Beschriftung mit `[` darin ist zweideutig; dann lieber Text.
  if (label === '' || label.includes('[')) return undefined;
  const close = findClose(')', middle + 2);
  if (close === -1) return undefined;
  const url = text.slice(middle + 2, close);
  if (/\s/.test(url.trim()) || url.length > 2048) return undefined;
  return { label, url, end: close + 1 };
}

/**
 * Die Ids aller Wiki-Seiten, auf die ein Markdown-Text verlinkt, in der
 * Reihenfolge ihres ersten Vorkommens, ohne Dubletten. Code-Bloecke und
 * Inline-Code zaehlen nicht — dort ist `page:…` nur Text. Hoechstens `max`.
 */
export function extractPageLinks(source: string, max = Number.POSITIVE_INFINITY): string[] {
  const found = new Set<string>();
  const visit = (nodes: readonly Inline[]): void => {
    for (const node of nodes) {
      if (found.size >= max) return;
      if (node.type === 'pagelink') found.add(node.id);
      if (node.type === 'strong' || node.type === 'em' || node.type === 'link' || node.type === 'pagelink') {
        visit(node.children);
      }
    }
  };
  for (const block of parseMarkdown(source)) {
    if (block.type === 'heading' || block.type === 'paragraph' || block.type === 'quote') {
      visit(block.children);
    } else if (block.type === 'list') {
      for (const item of block.items) visit(item);
    }
  }
  return [...found];
}

/**
 * Die Verweise `@{…}` eines Markdown-Texts (ADR 0023), wie `extractPageLinks`:
 * Reihenfolge des ersten Vorkommens, ohne Dubletten, Code zaehlt nicht.
 * Hoechstens `max`.
 */
export function extractRefTokens(source: string, max = Number.POSITIVE_INFINITY): string[] {
  const found = new Set<string>();
  const visit = (nodes: readonly Inline[]): void => {
    for (const node of nodes) {
      if (found.size >= max) return;
      if (node.type === 'ref') found.add(node.ref);
      if (node.type === 'strong' || node.type === 'em' || node.type === 'link' || node.type === 'pagelink') {
        visit(node.children);
      }
    }
  };
  for (const block of parseMarkdown(source)) {
    if (block.type === 'heading' || block.type === 'paragraph' || block.type === 'quote') {
      visit(block.children);
    } else if (block.type === 'list') {
      for (const item of block.items) visit(item);
    }
  }
  return [...found];
}

/** Ein Abschnitt einer Seite fuer „Create task from section“: Ueberschrift und Text darunter. */
export interface PageSection {
  heading: string;
  /** Der Markdown-Text des Abschnitts samt Ueberschrift, gekuerzt. */
  excerpt: string;
}

/**
 * Die Abschnitte einer Seite: je Ueberschrift der Text bis zur naechsten
 * Ueberschrift gleicher oder hoeherer Ebene. Ausserhalb von Code-Bloecken.
 * Ohne Ueberschrift gibt es keinen Abschnitt.
 */
export function pageSections(source: string, excerptMax = 500): PageSection[] {
  const lines = source.split(/\r?\n/);
  const headings: { index: number; level: number; text: string }[] = [];
  let fenced = false;
  lines.forEach((line, index) => {
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (fenced) return;
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      headings.push({ index, level: match[1].length, text: match[2] });
    }
  });
  return headings.map((heading, position) => {
    const next = headings.slice(position + 1).find((candidate) => candidate.level <= heading.level);
    const body = lines.slice(heading.index, next?.index ?? lines.length).join('\n').trim();
    return {
      heading: heading.text,
      excerpt: body.length > excerptMax ? `${body.slice(0, excerptMax - 1)}…` : body,
    };
  });
}
