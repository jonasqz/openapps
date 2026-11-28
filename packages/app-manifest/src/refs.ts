/**
 * Verweise zwischen Apps (ADR 0023 A): ein Format, geteilt von SDK, Control
 * Plane und Apps. Absichtlich ohne zod und ohne andere Abhaengigkeit, damit
 * das SDK es ueber `@openapps/app-manifest/refs` laden kann, ohne das
 * Manifest-Schema mitzuziehen.
 *
 * Zwei Arten, an der Zahl der Teile unterscheidbar:
 *
 * - **Objekt:** `<app>:<typ>:<id>`, etwa `tasks:task:42`. `app` folgt der
 *   Regel fuer App-Namen und ist keiner der gesperrten Namen, `typ` ist ein
 *   Slug, `id` besteht aus URL-sicheren Zeichen ohne Doppelpunkt.
 * - **Subjekt:** `human:<email>`, `group:<name>`, `agent:<name>`. Zwei Teile.
 *   Weil `human`, `group`, `agent`, `app` und `platform` als App-Namen
 *   gesperrt sind, ist jeder Wert eindeutig das eine oder das andere.
 *
 * In gespeichertem Text steht nur der Verweis, nie der Titel, in der
 * Schreibweise `@{app:typ:id}` (`@{tasks:task:42}`, `@{human:anna@example.com}`).
 */

/** Namen, die keine App tragen darf (ADR 0022 A, ADR 0023 A). */
export const RESERVED_APP_NAMES: readonly string[] = Object.freeze([
  'platform',
  'human',
  'group',
  'agent',
  'app',
]);

/** Die Arten von Subjekten, die ein Verweis nennen kann. */
export const REF_SUBJECT_KINDS = ['human', 'group', 'agent'] as const;
export type RefSubjectKind = (typeof REF_SUBJECT_KINDS)[number];

export const REF_LIMITS = Object.freeze({
  /** Laenge eines Verweises ohne `@{` und `}`. */
  ref: 400,
  type: 40,
  id: 128,
  email: 320,
  /** Hoechstens so viele Verweise liefert `extractRefs` ohne Angabe. */
  extractDefault: 200,
});

const APP_NAME = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;
const TYPE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const ID = /^[A-Za-z0-9._~-]+$/;
const EMAIL = /^[^@\s,:;<>"{}()[\]\\]+@[^@\s,:;<>"{}()[\]\\]+$/;
const GROUP_NAME = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;
const AGENT_NAME = /^[a-z][a-z0-9-]{1,62}$/;

export interface ObjectRef {
  readonly kind: 'object';
  readonly app: string;
  readonly type: string;
  readonly id: string;
  /** Die feste Form, `<app>:<typ>:<id>`. */
  readonly ref: string;
}

export interface SubjectRef {
  readonly kind: 'subject';
  readonly subjectKind: RefSubjectKind;
  /** E-Mail (klein), Gruppen- oder Agent-Name. */
  readonly id: string;
  /** Die feste Form, `human:<email>` usw. */
  readonly ref: string;
}

export type ParsedRef = ObjectRef | SubjectRef;

/** Ist das ein App-Name, der in einem Verweis stehen darf? */
export function isRefAppName(value: string): boolean {
  return APP_NAME.test(value) && !RESERVED_APP_NAMES.includes(value);
}

/** Ist das ein Typ-Slug fuer Objekte (`task`, `deal`, `next-step`)? */
export function isRefType(value: string): boolean {
  return value.length <= REF_LIMITS.type && TYPE.test(value);
}

/** Ist das eine Objekt-Id (URL-sicher, ohne Doppelpunkt)? */
export function isRefId(value: string): boolean {
  return value.length >= 1 && value.length <= REF_LIMITS.id && ID.test(value);
}

/**
 * Liest einen Verweis. `null`, wenn er keiner der beiden Formen entspricht.
 * Eine E-Mail wird kleingeschrieben; sonst wird nichts zurechtgebogen.
 */
export function parseRef(value: unknown): ParsedRef | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > REF_LIMITS.ref) {
    return null;
  }
  const parts = value.split(':');
  if (parts.length === 3) {
    const [app = '', type = '', id = ''] = parts;
    if (!isRefAppName(app) || !isRefType(type) || !isRefId(id)) return null;
    return { kind: 'object', app, type, id, ref: `${app}:${type}:${id}` };
  }
  if (parts.length === 2) {
    const [kind = '', rawId = ''] = parts;
    switch (kind) {
      case 'human': {
        const email = rawId.trim().toLowerCase();
        if (email.length > REF_LIMITS.email || !EMAIL.test(email)) return null;
        return { kind: 'subject', subjectKind: 'human', id: email, ref: `human:${email}` };
      }
      case 'group':
        return GROUP_NAME.test(rawId)
          ? { kind: 'subject', subjectKind: 'group', id: rawId, ref: `group:${rawId}` }
          : null;
      case 'agent':
        return AGENT_NAME.test(rawId)
          ? { kind: 'subject', subjectKind: 'agent', id: rawId, ref: `agent:${rawId}` }
          : null;
      default:
        return null;
    }
  }
  return null;
}

/** Nur Objekt-Verweise, sonst `null`. */
export function parseObjectRef(value: unknown): ObjectRef | null {
  const parsed = parseRef(value);
  return parsed?.kind === 'object' ? parsed : null;
}

/** Nur Subjekt-Verweise, sonst `null`. */
export function parseSubjectRef(value: unknown): SubjectRef | null {
  const parsed = parseRef(value);
  return parsed?.kind === 'subject' ? parsed : null;
}

/** Fehler beim Formatieren: ein Teil passt nicht in das Format. */
export class RefFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefFormatError';
  }
}

/** `<app>:<typ>:<id>`. Wirft `RefFormatError`, wenn ein Teil nicht passt. */
export function formatObjectRef(input: {
  readonly app: string;
  readonly type: string;
  readonly id: string;
}): string {
  const value = `${input.app}:${input.type}:${input.id}`;
  const parsed = parseObjectRef(value);
  if (parsed === null) {
    throw new RefFormatError(
      `"${value}" is not an object reference: expected <app>:<type>:<id> with a non-reserved app name, a slug as type and an id of [A-Za-z0-9._~-]`,
    );
  }
  return parsed.ref;
}

/** `human:<email>`, `group:<name>`, `agent:<name>`. Wirft `RefFormatError`. */
export function formatSubjectRef(kind: RefSubjectKind, id: string): string {
  const parsed = parseSubjectRef(`${kind}:${id}`);
  if (parsed === null) {
    throw new RefFormatError(`"${kind}:${id}" is not a reference to a person, group or agent`);
  }
  return parsed.ref;
}

/** Die Schreibweise im Text: `@{<ref>}`. Wirft `RefFormatError` fuer einen ungueltigen Verweis. */
export function formatRefToken(ref: string): string {
  const parsed = parseRef(ref);
  if (parsed === null) throw new RefFormatError(`"${ref}" is not a reference`);
  return `@{${parsed.ref}}`;
}

/** Ein Abschnitt eines Textes: Klartext oder ein Verweis. */
export type RefSegment =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'ref'; readonly ref: ParsedRef; readonly raw: string };

/**
 * `@{` und `}` mit etwas dazwischen, das kein Leerzeichen und keine Klammer
 * enthaelt. Ob es ein gueltiger Verweis ist, entscheidet danach `parseRef`.
 */
const TOKEN = /@\{([^{}\s]{1,400})\}/g;

/**
 * Teilt einen Text in Klartext und Verweise, fuer die Anzeige. Ein Token, das
 * kein gueltiger Verweis ist, bleibt Klartext.
 */
export function splitRefTokens(text: string): RefSegment[] {
  const segments: RefSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const parsed = parseRef(match[1]);
    if (parsed === null) continue;
    const start = match.index ?? 0;
    if (start > last) segments.push({ kind: 'text', text: text.slice(last, start) });
    segments.push({ kind: 'ref', ref: parsed, raw: match[0] });
    last = start + match[0].length;
  }
  if (last < text.length) segments.push({ kind: 'text', text: text.slice(last) });
  return segments;
}

/**
 * Alle gueltigen Verweise in einem Text, in der Reihenfolge ihres ersten
 * Auftretens, ohne Doppel, hoechstens `max`.
 */
export function extractRefs(text: string, max: number = REF_LIMITS.extractDefault): ParsedRef[] {
  const seen = new Set<string>();
  const refs: ParsedRef[] = [];
  for (const match of text.matchAll(TOKEN)) {
    if (refs.length >= max) break;
    const parsed = parseRef(match[1]);
    if (parsed === null || seen.has(parsed.ref)) continue;
    seen.add(parsed.ref);
    refs.push(parsed);
  }
  return refs;
}
