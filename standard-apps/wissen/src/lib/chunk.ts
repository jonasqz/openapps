/**
 * Zerlegt einen Text in Abschnitte fuer das Retrieval. Reine Funktion: kein
 * I/O, gleiche Eingabe ergibt gleiche Ausgabe. `documents.add` und das
 * Nachzerlegen der Beispieldokumente beim Start benutzen genau diese.
 *
 * Regeln, in dieser Reihenfolge:
 *
 * 1. Getrennt wird an Absatzgrenzen (Leerzeile).
 * 2. Ist ein Absatz zu lang, an Satzgrenzen.
 * 3. Ist ein Satz zu lang, an Wortgrenzen, und erst wenn es auch keine gibt,
 *    hart nach Zeichen (ohne ein Surrogatpaar zu zerreissen).
 * 4. Die Stuecke werden zu Abschnitten von etwa `target` Zeichen gepackt, nie
 *    mehr als `max`.
 * 5. Jeder Abschnitt ausser dem ersten beginnt mit etwa `overlap` Zeichen vom
 *    Ende des vorigen, moeglichst ab einem Satzanfang — so geht ein Gedanke,
 *    der ueber die Grenze laeuft, in keinem der beiden Abschnitte verloren.
 * 6. Leere Abschnitte entfallen.
 *
 * Laengen sind UTF-16-Einheiten (`String.length`). Fuer deutschen Text ist das
 * dasselbe wie Zeichen.
 */

export interface ChunkOptions {
  /** Ziellaenge eines Abschnitts. */
  readonly target: number;
  /** Harte Obergrenze eines Abschnitts, einschliesslich Ueberlappung. */
  readonly max: number;
  /** Etwa so viele Zeichen vom Ende des vorigen Abschnitts. 0 schaltet ab. */
  readonly overlap: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = { target: 800, max: 1200, overlap: 150 };

const PARAGRAPH_JOIN = '\n\n';
const SENTENCE_JOIN = ' ';

/** Ein Stueck, das nicht weiter zerlegt wird, und wie es an das vorige anschliesst. */
interface Unit {
  readonly text: string;
  readonly join: typeof PARAGRAPH_JOIN | typeof SENTENCE_JOIN;
}

export function chunkText(text: string, options: Partial<ChunkOptions> = {}): string[] {
  const opts = resolveOptions(options);
  const units = toUnits(text, unitLimit(opts));
  if (units.length === 0) return [];

  const chunks: string[] = [];
  let current = '';

  for (const unit of units) {
    if (current === '') {
      current = unit.text;
      continue;
    }
    const candidate = current + unit.join + unit.text;
    // Bis zur Ziellaenge wird immer angehaengt. Ein Abschnitt, der noch unter
    // der halben Ziellaenge liegt, darf bis `max` wachsen, statt als Splitter
    // stehen zu bleiben.
    if (
      candidate.length <= opts.target ||
      (current.length < opts.target / 2 && candidate.length <= opts.max)
    ) {
      current = candidate;
      continue;
    }

    chunks.push(current);
    const tail = overlapTail(current, opts.overlap);
    // `unitLimit` laesst vor jedem Stueck Platz fuer die Ueberlappung; die
    // Pruefung bleibt trotzdem, damit `max` nie von dieser Annahme abhaengt.
    current =
      tail !== '' && tail.length + unit.join.length + unit.text.length <= opts.max
        ? tail + unit.join + unit.text
        : unit.text;
  }

  if (current !== '') chunks.push(current);
  return chunks.map((chunk) => chunk.trim()).filter((chunk) => chunk !== '');
}

function resolveOptions(options: Partial<ChunkOptions>): ChunkOptions {
  const opts: ChunkOptions = {
    target: options.target ?? DEFAULT_CHUNK_OPTIONS.target,
    max: options.max ?? DEFAULT_CHUNK_OPTIONS.max,
    overlap: options.overlap ?? DEFAULT_CHUNK_OPTIONS.overlap,
  };
  for (const [name, value] of Object.entries(opts)) {
    if (!Number.isInteger(value) || value < 0) {
      throw new RangeError(`chunkText: ${name} muss eine ganze Zahl >= 0 sein, ist ${value}`);
    }
  }
  if (opts.target < 1 || opts.max < opts.target) {
    throw new RangeError('chunkText: erwartet 1 <= target <= max');
  }
  if (opts.overlap >= opts.target) {
    throw new RangeError('chunkText: overlap muss kleiner als target sein');
  }
  return opts;
}

/**
 * Hoechstlaenge eines einzelnen Stuecks: so, dass die Ueberlappung samt
 * Verbinder noch davor passt und der Abschnitt `max` nicht ueberschreitet.
 */
function unitLimit(opts: ChunkOptions): number {
  return Math.max(1, opts.max - opts.overlap - PARAGRAPH_JOIN.length);
}

/** Absaetze, bei Bedarf Saetze, bei Bedarf Wortgruppen, als letztes harte Stuecke. */
function toUnits(text: string, limit: number): Unit[] {
  const units: Unit[] = [];
  const paragraphs = text
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n+/)
    .map((paragraph) => normalizeWhitespace(paragraph))
    .filter((paragraph) => paragraph !== '');

  for (const paragraph of paragraphs) {
    let join: Unit['join'] = PARAGRAPH_JOIN;
    for (const piece of splitParagraph(paragraph, limit)) {
      units.push({ text: piece, join });
      join = SENTENCE_JOIN;
    }
  }
  return units;
}

/** Zeilenumbrueche innerhalb eines Absatzes bleiben, mehrfache Leerzeichen nicht. */
function normalizeWhitespace(paragraph: string): string {
  return paragraph
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v ]+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n');
}

function splitParagraph(paragraph: string, limit: number): string[] {
  if (paragraph.length <= limit) return [paragraph];
  const pieces: string[] = [];
  for (const sentence of splitSentences(paragraph)) {
    if (sentence.length <= limit) {
      pieces.push(sentence);
    } else {
      pieces.push(...splitHard(sentence, limit));
    }
  }
  return pieces;
}

/**
 * Satzende: `.`, `!`, `?` oder `…`, optional gefolgt von schliessenden
 * Anfuehrungszeichen oder Klammern, dann Leerraum. Abkuerzungen wie „z. B.“
 * erzeugen dabei zu viele Grenzen; das schadet nicht, weil die Stuecke danach
 * wieder zu Abschnitten gepackt werden.
 */
const SENTENCE_END = /(?<=[.!?…]["'“”»«)\]]*)\s+/u;

export function splitSentences(paragraph: string): string[] {
  return paragraph
    .split(SENTENCE_END)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== '');
}

/** Wortgrenze, wenn moeglich in der hinteren Haelfte; sonst hart, ohne Surrogatpaar zu teilen. */
export function splitHard(text: string, limit: number): string[] {
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf(' ', limit);
    if (cut < Math.floor(limit / 2)) {
      cut = limit;
      if (isHighSurrogate(rest.charCodeAt(cut - 1)) && cut > 1) cut -= 1;
    }
    const piece = rest.slice(0, cut).trim();
    if (piece !== '') pieces.push(piece);
    rest = rest.slice(cut).trimStart();
  }
  if (rest.trim() !== '') pieces.push(rest.trim());
  return pieces;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * Das Ende eines Abschnitts als Ueberlappung fuer den naechsten.
 *
 * Bevorzugt ab einem Satz- oder Absatzanfang, der zwischen der halben und der
 * anderthalbfachen Ueberlappung vom Ende entfernt liegt (der naechste an
 * `overlap` gewinnt); sonst ab einer Wortgrenze; sonst hart. Nie mehr als die
 * Haelfte des Abschnitts, sonst wiederholt ein kurzer Abschnitt sich ganz.
 */
export function overlapTail(chunk: string, overlap: number): string {
  if (overlap <= 0) return '';
  const want = Math.min(overlap, Math.floor(chunk.length / 2));
  if (want <= 0) return '';

  const lower = Math.ceil(want / 2);
  const upper = Math.min(Math.floor(want * 1.5), Math.floor(chunk.length / 2));
  let best: number | undefined;
  const boundary = /(?:[.!?…]["'“”»«)\]]*\s+|\n+)/gu;
  for (let match = boundary.exec(chunk); match !== null; match = boundary.exec(chunk)) {
    const start = match.index + match[0].length;
    const length = chunk.length - start;
    if (length < lower || length > upper) continue;
    if (best === undefined || Math.abs(length - want) < Math.abs(chunk.length - best - want)) {
      best = start;
    }
  }
  if (best !== undefined) return chunk.slice(best).trim();

  const from = chunk.length - want;
  const space = chunk.indexOf(' ', from);
  if (space !== -1 && chunk.length - space - 1 >= lower) return chunk.slice(space + 1).trim();
  let start = from;
  if (isLowSurrogate(chunk.charCodeAt(start))) start += 1;
  return chunk.slice(start).trim();
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}
