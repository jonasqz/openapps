import {
  callerOf,
  parseArgs,
  ToolInputError,
  type ToolContext,
  type ToolHandler,
} from '@openapps/sdk';
import { answerQuestion, askerOf } from './answer';
import { query } from './db';
import {
  addDocument,
  deleteDocument,
  getDocument,
  listDocuments,
  removeSourceDocument,
  upsertSourceDocument,
} from './documents';
import { searchOwnDocuments } from './document-search';
import { backfillEmbeddings, embeddingStatus } from './embeddings';
import { embeddingWorker, fulltextRetriever, hybridRetriever } from './knowledge-runtime';
import { models } from './platform-models';
import type { Retriever } from './retriever';
import {
  AnswerArgs,
  DeleteArgs,
  DocumentInput,
  DocumentSearchArgs,
  GetArgs,
  ListArgs,
  NoArgs,
  RemoveArgs,
  SearchArgs,
  UpsertArgs,
} from './schemas';
import type { Visibility } from './visibility';

/**
 * Die Tools dieser App, je Name aus `app.json` ein Handler. Der Route-Handler
 * `app/api/tools/[tool]/route.ts` reicht diese Tabelle an `createToolRoute`;
 * ein Test prueft, dass sie mit `app.json` und `openapi.yaml` uebereinstimmt.
 *
 * Jeder Handler prueft seine Argumente mit `parseArgs` — eine falsche Eingabe
 * ergibt 400 mit den Befunden, damit ein Agent seinen Aufruf korrigieren kann.
 *
 * Zwei Werte kommen nie aus den Argumenten, sondern aus dem signierten
 * Kontext der Plattform (ADR 0020):
 *
 * - die lesbaren Apps (`ctx.readableApps`) fuer jede lesende Abfrage;
 * - die Quell-App (`ctx.caller`) fuer `documents.upsert` und
 *   `documents.remove`. Die strengen Schemas lehnen ein Feld `sourceApp` ab.
 */

/**
 * Die Suche fuer `search`, `answer` und die Suchseite: hybrid (ADR 0025),
 * und ohne Embedding-Modell genau der Volltext aus 0.2.
 */
export function currentRetriever(): Retriever {
  return hybridRetriever();
}

/**
 * Die Sichtbarkeit des Aufrufers, aus der Plattform, nicht aus den
 * Argumenten. Fehlt sie, nur eigene Dokumente (Default-Deny).
 */
export function visibilityOf(ctx: ToolContext): Visibility {
  return { readableApps: ctx.readableApps ?? null };
}

/**
 * Die Quell-App eines Aufrufs: nur eine App, die nachweislich selbst ruft.
 * Ein Mensch oder Agent legt Dokumente mit `documents.add` an.
 */
export function sourceAppOf(ctx: ToolContext, tool: string): string {
  const caller = ctx.caller ?? callerOf(ctx.user);
  if (caller.kind !== 'app') {
    throw new ToolInputError(
      `${tool} is for apps that deliver their own content to search. Use documents.add to store a document.`,
    );
  }
  return caller.app;
}

export const toolHandlers = {
  search: async (args, ctx) => {
    const { query: text, limit } = parseArgs(SearchArgs, args);
    return { passages: await currentRetriever().search(text, limit, visibilityOf(ctx)) };
  },
  'documents.search': async (args) => {
    const { query: text, limit } = parseArgs(DocumentSearchArgs, args);
    // Nur Volltext: Die Plattform fragt dieses Tool beim Tippen, mit etwa
    // 2 s je App (ADR 0021). Ein Modell-Aufruf je Tastendruck waere zu
    // langsam und zu teuer.
    return searchOwnDocuments(fulltextRetriever(), text, limit);
  },
  answer: async (args, ctx) => {
    const { question, limit } = parseArgs(AnswerArgs, args);
    return answerQuestion(
      { retriever: currentRetriever(), models: models() },
      {
        question,
        limit,
        visibility: visibilityOf(ctx),
        onBehalfOf: askerOf(ctx.caller ?? callerOf(ctx.user)),
      },
    );
  },
  'embeddings.status': async (args, ctx) => {
    parseArgs(NoArgs, args ?? {});
    return embeddingStatus(query, models(), visibilityOf(ctx));
  },
  'embeddings.backfill': async (args, ctx) => {
    parseArgs(NoArgs, args ?? {});
    const { retriedWithheld, report } = await backfillEmbeddings(query, embeddingWorker());
    return {
      retriedWithheld,
      embedded: report.embedded,
      withheld: report.withheld,
      pending: report.pending,
      removedOld: report.removedOld,
      stopped: report.stopped,
      status: await embeddingStatus(query, models(), visibilityOf(ctx)),
    };
  },
  'documents.add': async (args, ctx) => addDocument(parseArgs(DocumentInput, args), ctx.user.id),
  'documents.list': async (args, ctx) => ({
    documents: await listDocuments(parseArgs(ListArgs, args), visibilityOf(ctx)),
  }),
  'documents.get': async (args, ctx) => getDocument(parseArgs(GetArgs, args), visibilityOf(ctx)),
  'documents.delete': async (args) => deleteDocument(parseArgs(DeleteArgs, args).id),
  'documents.upsert': async (args, ctx) => {
    const sourceApp = sourceAppOf(ctx, 'documents.upsert');
    return upsertSourceDocument(parseArgs(UpsertArgs, args), sourceApp, ctx.user.id);
  },
  'documents.remove': async (args, ctx) => {
    const sourceApp = sourceAppOf(ctx, 'documents.remove');
    return removeSourceDocument(parseArgs(RemoveArgs, args), sourceApp);
  },
} satisfies Record<string, ToolHandler>;

export type ToolName = keyof typeof toolHandlers;
