/**
 * Die Tastatur-Triage von Home (ADR 0022 D), ohne React: welche Taste was
 * tut und wie sich die Liste danach aendert. Eigene Datei, damit die Tests
 * sie ohne Browser pruefen.
 *
 * Tasten (wie in verbreiteten Postfaechern):
 *
 * - `j` / Pfeil runter: naechster Eintrag, `k` / Pfeil hoch: vorheriger
 * - `Enter` / `o`: oeffnen (markiert gelesen)
 * - `r`: gelesen, `u`: ungelesen, `e`: erledigt
 *
 * In Eingabefeldern, Auswahllisten und mit Strg, Cmd oder Alt tut keine
 * Taste etwas: Dort gehoert sie dem Feld oder dem Browser (Cmd+K ist die
 * Befehlspalette).
 */

export type TriageCommand = 'next' | 'previous' | 'open' | 'read' | 'unread' | 'done';

export type TriageView = 'open' | 'done';

export type TriageState = 'unread' | 'read' | 'done';

export interface TriageItem {
  readonly id: string;
  readonly state: TriageState;
}

const KEYS: Readonly<Record<string, TriageCommand>> = {
  j: 'next',
  ArrowDown: 'next',
  k: 'previous',
  ArrowUp: 'previous',
  Enter: 'open',
  o: 'open',
  r: 'read',
  u: 'unread',
  e: 'done',
};

const TYPING = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

export interface KeyInput {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  /** `tagName` des Ziels, gross geschrieben wie im DOM. */
  readonly targetTag: string | null;
  readonly targetEditable?: boolean;
}

export function commandForKey(input: KeyInput): TriageCommand | null {
  if (input.metaKey || input.ctrlKey || input.altKey) return null;
  if (input.targetEditable === true) return null;
  if (input.targetTag !== null && TYPING.has(input.targetTag)) return null;
  // Enter auf einem Knopf oder Link gehoert dem Element, nicht der Triage.
  if (input.key === 'Enter' && (input.targetTag === 'BUTTON' || input.targetTag === 'A')) {
    return null;
  }
  return Object.hasOwn(KEYS, input.key) ? (KEYS[input.key] ?? null) : null;
}

/** Neuer Index nach `next` oder `previous`, an den Enden festgehalten. */
export function moveIndex(index: number, length: number, command: TriageCommand): number {
  if (length === 0) return 0;
  if (command === 'next') return Math.min(index + 1, length - 1);
  if (command === 'previous') return Math.max(index - 1, 0);
  return Math.min(Math.max(index, 0), length - 1);
}

/**
 * Die Liste nach einer Markierung: In der Ansicht „open" verschwindet, was
 * erledigt ist, in „done" was wieder offen ist. Sonst aendert sich nur der
 * Zustand.
 */
export function applyMark<T extends TriageItem>(
  items: readonly T[],
  ids: readonly string[],
  state: TriageState,
  view: TriageView,
): T[] {
  const marked = new Set(ids);
  const result: T[] = [];
  for (const item of items) {
    if (!marked.has(item.id)) {
      result.push(item);
      continue;
    }
    const stays = view === 'open' ? state !== 'done' : state === 'done';
    if (stays) result.push({ ...item, state });
  }
  return result;
}
