import type { Caller } from '@openapps/sdk';
import type { PlatformModels, SourcedText } from './platform-models';
import type { Passage, Retriever } from './retriever';
import type { Visibility } from './visibility';

/**
 * `answer`: eine Antwort mit Zitaten aus den Abschnitten, die der Aufrufer
 * lesen darf (ADR 0025 E).
 *
 * 1. Gesucht wird mit der Sichtbarkeit des Aufrufers, wie bei `search`.
 *    Nur diese Abschnitte gehen an `platform.generate`, jeder mit seiner
 *    Quell-App. Inhalte aus Apps in `OPENAPPS_MODEL_LOCAL_ONLY_APPS` haelt die
 *    Plattform bei einem externen Anbieter zurueck (`withheld`); sie gelten
 *    dann als nicht uebergeben.
 * 2. Das Modell antwortet als JSON mit `answer` und `citations` (Ids der
 *    Abschnitte). Knowledge prueft **jedes** Zitat: Es muss auf einen
 *    Abschnitt zeigen, der dem Modell wirklich vorlag. Ein einziges
 *    erfundenes Zitat verwirft die ganze Antwort, ebenso eine Antwort ohne
 *    Zitat. Dann kommt `no_answer` mit den Abschnitten, nicht geraten.
 * 3. Ohne Chat-Modell `not_configured` mit dem Hinweis auf `search`. Das
 *    Tool steht trotzdem im Manifest, weil das Manifest statisch ist.
 *
 * Abschnitte sind fremder Text im Prompt. Das Modell hat keine Tools; eine
 * Injection kann die Antwort verzerren, aber nichts ausfuehren, und sie kann
 * kein Zitat auf einen Abschnitt erfinden, den der Aufrufer nicht lesen darf.
 */

export const ANSWER_PASSAGES_DEFAULT = 8;
export const ANSWER_MAX_TOKENS = 800;
/** Laenger darf eine Antwort nicht sein; was darueber liegt, ist kein Antworttext. */
export const ANSWER_TEXT_MAX = 6000;

export interface Citation {
  readonly chunkId: string;
  readonly documentId: string;
  readonly documentTitle: string;
  readonly ord: number;
  readonly source: string | null;
  readonly sourceApp: string | null;
  readonly sourcePath: string | null;
  readonly sourceUrl: string | null;
}

export type NoAnswerReason =
  /** Die Suche fand nichts. Kein Modell wurde gefragt. */
  | 'no_passages'
  /** Das Modell sagt, die Abschnitte beantworten die Frage nicht. */
  | 'not_in_sources'
  /** Die Antwort nannte kein Zitat. */
  | 'no_citation'
  /** Ein Zitat zeigt auf einen Abschnitt, der nicht vorlag. */
  | 'invalid_citation'
  /** Die Antwort hatte nicht die verlangte Form. */
  | 'unreadable'
  /** Die Plattform hat alle Abschnitte zurueckgehalten. */
  | 'withheld'
  /** Tagesgrenze erreicht. */
  | 'budget_exceeded'
  /** Plattform oder Anbieter antworten nicht. */
  | 'model_error';

export type AnswerResult =
  | {
      readonly status: 'answered';
      readonly answer: string;
      readonly citations: readonly Citation[];
      /** Die Abschnitte, die das Modell bekam. */
      readonly passages: readonly Passage[];
    }
  | {
      readonly status: 'no_answer';
      readonly reason: NoAnswerReason;
      readonly message: string;
      /** Die Abschnitte, die der Aufrufer lesen darf, zum Selbst-Antworten. */
      readonly passages: readonly Passage[];
    }
  | { readonly status: 'not_configured'; readonly message: string };

export const NOT_CONFIGURED_MESSAGE =
  'No chat model is configured on this platform. Use search and answer from the returned passages yourself, citing their sources.';

const MESSAGES: Readonly<Record<NoAnswerReason, string>> = {
  no_passages: 'Nothing in the documents matches this question. Do not guess.',
  not_in_sources:
    'The sections found do not answer this question. Read the passages yourself; do not guess.',
  no_citation: 'The model answered without citing a section, so the answer was discarded.',
  invalid_citation:
    'The model cited a section it was not given, so the answer was discarded. Use the passages instead.',
  unreadable: 'The model did not answer in the expected form. Use the passages instead.',
  withheld:
    'The sections come from apps whose content stays in-house, and the model provider is external. Use the passages instead.',
  budget_exceeded:
    'The daily model limit is reached. Use the passages instead, or try again tomorrow (UTC).',
  model_error: 'The model did not answer. Use the passages instead, or try again later.',
};

/** Die Anweisung an `generate`. Die Frage ist Inhalt von Knowledge selbst. */
export function answerInstruction(question: string): string {
  return [
    'Answer the question using only the sections given in <content> tags.',
    'Reply with JSON only, no other text: {"answer": string | null, "citations": string[]}.',
    '"citations" lists the id attribute of every section the answer relies on; cite at least one.',
    'Use only ids that appear in the <content> tags. Never invent an id.',
    'If the sections do not answer the question, reply {"answer": null, "citations": []}.',
    'Answer in the language of the question, briefly and factually.',
    '',
    `Question: ${question}`,
  ].join('\n');
}

/** Der Text eines Abschnitts fuer das Modell: Titel und Abschnitt. */
export function contentOf(passage: Passage): SourcedText {
  return {
    id: passage.chunkId,
    sourceApp: passage.sourceApp ?? 'knowledge',
    text: `${passage.documentTitle}\n\n${passage.text}`,
  };
}

export interface ParsedAnswer {
  readonly answer: string | null;
  readonly citations: readonly string[];
}

/**
 * Liest die Antwort des Modells. Erlaubt ist ein JSON-Objekt, auch in einem
 * Codeblock; alles andere ist `null`. Kein Raten: Ein Satz ohne JSON ist
 * keine Antwort.
 */
export function parseModelAnswer(text: string): ParsedAnswer | null {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  let value: unknown;
  try {
    value = JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const answer = record.answer;
  const citations = record.citations ?? [];
  if (answer !== null && typeof answer !== 'string') return null;
  if (!Array.isArray(citations) || !citations.every((c) => typeof c === 'string')) return null;
  return {
    answer: typeof answer === 'string' && answer.trim() !== '' ? answer.trim() : null,
    citations: citations as string[],
  };
}

/**
 * Prueft die Zitate gegen die Abschnitte, die dem Modell vorlagen. Gibt die
 * Zitate in der Reihenfolge der Antwort zurueck, ohne Dubletten, oder den
 * Grund, warum die Antwort verworfen wird.
 */
export function checkCitations(
  cited: readonly string[],
  given: ReadonlyMap<string, Passage>,
):
  | { readonly ok: true; readonly citations: Citation[] }
  | { readonly ok: false; readonly reason: 'no_citation' | 'invalid_citation' } {
  if (cited.length === 0) return { ok: false, reason: 'no_citation' };
  const seen = new Set<string>();
  const citations: Citation[] = [];
  for (const id of cited) {
    const passage = given.get(id);
    if (passage === undefined) return { ok: false, reason: 'invalid_citation' };
    if (seen.has(id)) continue;
    seen.add(id);
    citations.push({
      chunkId: passage.chunkId,
      documentId: passage.documentId,
      documentTitle: passage.documentTitle,
      ord: passage.ord,
      source: passage.source,
      sourceApp: passage.sourceApp,
      sourcePath: passage.sourcePath,
      sourceUrl: passage.sourceUrl,
    });
  }
  return { ok: true, citations };
}

export interface AnswerDeps {
  readonly retriever: Retriever;
  readonly models: PlatformModels;
}

/** `answer` fuer eine Frage, mit der Sichtbarkeit des Aufrufers. */
export async function answerQuestion(
  deps: AnswerDeps,
  input: {
    readonly question: string;
    readonly limit: number;
    readonly visibility: Visibility;
    /** Wer fragt, nur als Angabe fuer das Audit der Plattform. */
    readonly onBehalfOf: string | null;
  },
): Promise<AnswerResult> {
  // Erst, ob es ein Chat-Modell gibt: ohne eines keine Suche, kein Aufruf.
  const info = await deps.models.info();
  if (
    info.status === 'not_configured' ||
    info.status === 'no_platform' ||
    info.status === 'denied'
  ) {
    return { status: 'not_configured', message: NOT_CONFIGURED_MESSAGE };
  }
  if (info.status === 'ok' && info.chat === null) {
    return { status: 'not_configured', message: NOT_CONFIGURED_MESSAGE };
  }

  const passages = await deps.retriever.search(input.question, input.limit, input.visibility);
  const noAnswer = (
    reason: NoAnswerReason,
    shown: readonly Passage[] = passages,
  ): AnswerResult => ({
    status: 'no_answer',
    reason,
    message: MESSAGES[reason],
    passages: shown,
  });
  if (passages.length === 0) return noAnswer('no_passages');

  const generated = await deps.models.generate({
    instruction: answerInstruction(input.question),
    contents: passages.map(contentOf),
    maxTokens: ANSWER_MAX_TOKENS,
    onBehalfOf: input.onBehalfOf,
  });
  if (generated.status !== 'ok') {
    switch (generated.status) {
      case 'withheld':
        return noAnswer('withheld');
      case 'budget_exceeded':
        return noAnswer('budget_exceeded');
      case 'error':
        return noAnswer('model_error');
      default:
        // not_configured, no_platform, denied: kein Chat-Modell fuer Knowledge.
        return { status: 'not_configured', message: NOT_CONFIGURED_MESSAGE };
    }
  }

  // Nur, was dem Modell wirklich vorlag, darf zitiert werden.
  const withheld = new Set(generated.withheld);
  const given = new Map<string, Passage>();
  for (const passage of passages) {
    if (!withheld.has(passage.chunkId)) given.set(passage.chunkId, passage);
  }
  if (given.size === 0) return noAnswer('withheld');

  const parsed = parseModelAnswer(generated.text);
  if (parsed === null) return noAnswer('unreadable');
  if (parsed.answer === null) return noAnswer('not_in_sources');
  if (parsed.answer.length > ANSWER_TEXT_MAX) return noAnswer('unreadable');
  const checked = checkCitations(parsed.citations, given);
  if (!checked.ok) return noAnswer(checked.reason);

  return {
    status: 'answered',
    answer: parsed.answer,
    citations: checked.citations,
    passages: [...given.values()],
  };
}

/** Wer fragt, als Angabe fuer das Audit: `user:<id>`, `agent:<name>`, `app:<name>`. */
export function askerOf(caller: Caller): string | null {
  const value =
    caller.kind === 'human'
      ? `user:${caller.id}`
      : caller.kind === 'agent'
        ? `agent:${caller.agent}`
        : `app:${caller.app}`;
  return /^(user|agent|app):[A-Za-z0-9][A-Za-z0-9._@:+-]{0,199}$/.test(value) ? value : null;
}
