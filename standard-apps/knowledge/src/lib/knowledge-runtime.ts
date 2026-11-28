import { query, withTransaction } from './db';
import { createEmbeddingWorker, type EmbeddingWorker } from './embeddings';
import { createHybridRetriever, type HybridRetriever } from './hybrid';
import { models, type PlatformModels } from './platform-models';
import { createFulltextRetriever, type Retriever } from './retriever';

/**
 * Die Teile von Knowledge, die einmal je Prozess entstehen: Volltext, die
 * hybride Suche darueber und die Warteschlange der Embeddings (ADR 0025).
 * Eigene Datei, damit `documents.ts` die Warteschlange anstossen kann, ohne
 * `tools.ts` zu importieren.
 */

/** Immer das aktuelle Modell, auch wenn ein Test es austauscht. */
const currentModels: PlatformModels = {
  info: () => models().info(),
  embed: (texts, options) => models().embed(texts, options),
  generate: (request) => models().generate(request),
};

let fulltext: Retriever | undefined;
let hybrid: HybridRetriever | undefined;
let worker: EmbeddingWorker | undefined;
let started = false;

/** Postgres-Volltext, wie in 0.2. */
export function fulltextRetriever(): Retriever {
  fulltext ??= createFulltextRetriever(query);
  return fulltext;
}

/** Volltext plus Vektor, wenn ein Embedding-Modell alles abdeckt; sonst genau der Volltext. */
export function hybridRetriever(): HybridRetriever {
  hybrid ??= createHybridRetriever({
    query,
    fulltext: fulltextRetriever(),
    models: () => currentModels,
  });
  return hybrid;
}

export function embeddingWorker(): EmbeddingWorker {
  worker ??= createEmbeddingWorker({ query, withTransaction, models: currentModels });
  return worker;
}

/** Beim Start der App (instrumentation.ts): erster Durchlauf, dann alle 60 s. */
export function startEmbeddings(): void {
  started = true;
  embeddingWorker().start();
}

/**
 * Nach dem Commit einer Aenderung: einbetten, ohne darauf zu warten. Wirft
 * nie. Ohne gestarteten Takt (Tests, Skripte) passiert nichts.
 */
export function kickEmbeddings(): void {
  if (started) embeddingWorker().kick();
}

/** Wie lange die Seite sich merkt, ob es ein Chat-Modell gibt. */
const CHAT_INFO_TTL_MS = 30_000;
let chatCache: { readonly at: number; readonly value: boolean } | null = null;

/**
 * Gibt es ein Chat-Modell fuer Knowledge? Fuer die Suchseite: Ohne Modell
 * ist die Antwort mit Zitaten nicht sichtbar (ADR 0024 A). Kurz gemerkt,
 * damit nicht jede Seite die Plattform fragt. Wirft nie.
 */
export async function chatAvailable(now: number = Date.now()): Promise<boolean> {
  if (chatCache !== null && now - chatCache.at < CHAT_INFO_TTL_MS) return chatCache.value;
  const info = await currentModels.info();
  const value = info.status === 'ok' && info.chat !== null;
  chatCache = { at: now, value };
  return value;
}
