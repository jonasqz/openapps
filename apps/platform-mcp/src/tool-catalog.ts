/**
 * Der Tool-Katalog einer MCP-Sitzung fuer `search_tools` und `describe_tool`
 * (ADR 0024, Nachtrag Code Mode, Punkt 1).
 *
 * Der Katalog enthaelt genau die Tools, die `createPlatformServer` fuer diesen
 * Aufrufer angemeldet hat, mit denselben Beschreibungen und Schemas wie in
 * `tools/list`. Keine zweite Wahrheit ueber Tools.
 *
 * Rechte: Es gibt hier keine eigene Pruefung. Ob ein App-Tool sichtbar ist,
 * entscheidet `listAppTools` aus der Domaene, und zwar **bei jedem Aufruf**
 * neu (`can` cached nicht). Ein Widerruf blendet ein Tool deshalb beim
 * naechsten Aufruf aus, auch auf einer bestehenden stdio-Verbindung. Ein Tool,
 * das erst nach dem Aufbau freigegeben wurde, ist in dieser Sitzung nicht
 * angemeldet und erscheint nicht: Es liesse sich unter dem Namen auch nicht
 * aufrufen.
 *
 * Plattform-Tools sind fuer jeden angemeldeten Aufrufer angemeldet (wie in
 * `tools/list`); ihre Freigabe pruefen sie beim Aufruf selbst in der Domaene.
 */

import { listAppTools, type Actor, type DomainContext } from '@openapps/control-plane/domain';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export const TOOL_SEARCH_LIMITS = Object.freeze({
  queryMin: 2,
  queryMax: 200,
  appsMax: 20,
  limitDefault: 10,
  limitMax: 25,
  summaryMax: 160,
  nameMax: 200,
});

/** Ressourcen-App der Plattform-Tools, wie in `tool:platform.<name>` (ADR 0022 A). */
export const PLATFORM_APP = 'platform';

export interface CatalogEntry {
  /** Der Name im MCP, unter dem das Tool aufgerufen wird. */
  readonly name: string;
  readonly kind: 'platform' | 'app';
  /** `<app>.<tool>` fuer App-Tools, `platform.<name>` fuer Plattform-Tools. */
  readonly resourceId: string;
  readonly app: string;
  readonly title: string;
  /** Die volle Beschreibung, wie `tools/list` sie zeigt. */
  readonly description: string;
  /** Eine Zeile fuer die Trefferliste (`toolSummary`). */
  readonly summary: string;
  /** JSON-Schema der Eingabe, ohne `$schema`. */
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export interface ToolCatalog {
  /** Was der Aufrufer jetzt ausfuehren darf, frisch geprueft. */
  visible(): Promise<readonly CatalogEntry[]>;
}

/** Dieselbe Umwandlung wie im MCP-SDK fuer `tools/list`, ohne `$schema`. */
export function jsonSchemaOf(shape: z.ZodRawShape): Record<string, unknown> {
  const schema = zodToJsonSchema(z.object(shape), { strictUnions: true }) as Record<
    string,
    unknown
  >;
  const { $schema: _ignored, ...rest } = schema;
  return rest;
}

export function createToolCatalog(input: {
  readonly ctx: DomainContext;
  readonly actor: Actor;
  readonly platform: readonly CatalogEntry[];
  /** Die angemeldeten App-Tools; die Liste fuellt der Server beim Anmelden. */
  readonly appTools: readonly CatalogEntry[];
}): ToolCatalog {
  return {
    async visible() {
      const allowed = new Set(
        (await listAppTools(input.ctx, input.actor)).map((tool) => tool.resourceId),
      );
      return [...input.platform, ...input.appTools.filter((e) => allowed.has(e.resourceId))];
    },
  };
}

/** Woerter aus Buchstaben und Ziffern, klein. `tasks__tasks__create` -> tasks, tasks, create. */
function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
}

export function queryWords(query: string): string[] {
  return [...new Set(wordsOf(query))];
}

/**
 * Einfache Textsuche ueber Name und Beschreibung, keine Embeddings. Punkte:
 * exakter Name oder Ressourcen-Id vor ganzer Phrase im Namen vor einzelnen
 * Woertern im Namen vor Woertern in der Beschreibung. Wer alle Woerter
 * trifft, steht vor dem, der nur einige trifft. Ohne Treffer kein Ergebnis.
 */
export function rankTools(
  entries: readonly CatalogEntry[],
  query: string,
  limit: number,
): CatalogEntry[] {
  const words = queryWords(query);
  if (words.length === 0) return [];
  const exact = query.trim().toLowerCase();
  const phrase = words.join(' ');

  const scored: { entry: CatalogEntry; score: number }[] = [];
  for (const entry of entries) {
    const nameWords = wordsOf(`${entry.name} ${entry.resourceId} ${entry.title}`);
    const nameText = nameWords.join(' ');
    const descriptionText = wordsOf(entry.description).join(' ');
    const descriptionWords = new Set(descriptionText.split(' '));

    let score = 0;
    let matched = 0;
    if (entry.name.toLowerCase() === exact || entry.resourceId.toLowerCase() === exact) {
      score += 1000;
    }
    if (words.length > 1 && nameText.includes(phrase)) score += 50;
    if (words.length > 1 && descriptionText.includes(phrase)) score += 10;
    for (const word of words) {
      let hit = false;
      if (nameWords.includes(word)) {
        score += 8;
        hit = true;
      } else if (nameText.includes(word)) {
        score += 5;
        hit = true;
      }
      if (descriptionWords.has(word)) {
        score += 2;
        hit = true;
      } else if (descriptionText.includes(word)) {
        score += 1;
        hit = true;
      }
      if (hit) matched += 1;
    }
    if (matched === 0) continue;
    if (matched === words.length) score += 20;
    scored.push({ entry, score });
  }

  return scored
    .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
    .slice(0, limit)
    .map((item) => item.entry);
}

/** Eine Zeile: der erste Satz der ersten Zeile, hoechstens 160 Zeichen. */
export function toolSummary(description: string): string {
  const line = description.trim().split('\n')[0]?.trim() ?? '';
  const sentenceEnd = line.search(/[.!?](\s|$)/);
  const sentence = sentenceEnd === -1 ? line : line.slice(0, sentenceEnd + 1);
  const max = TOOL_SEARCH_LIMITS.summaryMax;
  return sentence.length <= max ? sentence : `${sentence.slice(0, max - 1).trimEnd()}…`;
}
