import { parseArgs, type ToolHandler } from '@openapps/sdk';
import { query } from './db';
import { addDocument, deleteDocument, getDocument, listDocuments } from './documents';
import { createFulltextRetriever, type Retriever } from './retriever';
import { DeleteArgs, DocumentInput, GetArgs, ListArgs, SearchArgs } from './schemas';

/**
 * Die Tools dieser App, je Name aus `app.json` ein Handler. Der Route-Handler
 * `app/api/tools/[tool]/route.ts` reicht diese Tabelle an `createToolRoute`;
 * ein Test prueft, dass sie mit `app.json` und `openapi.yaml` uebereinstimmt.
 *
 * Jeder Handler prueft seine Argumente mit `parseArgs` — eine falsche Eingabe
 * ergibt 400 mit den Befunden, damit ein Agent seinen Aufruf korrigieren kann.
 */

let retriever: Retriever | undefined;

/** Heute Postgres-Volltext. Eine zweite Implementierung (pgvector) wird hier gewaehlt. */
export function currentRetriever(): Retriever {
  retriever ??= createFulltextRetriever(query);
  return retriever;
}

export const toolHandlers = {
  search: async (args) => {
    const { query: text, limit } = parseArgs(SearchArgs, args);
    return { passages: await currentRetriever().search(text, limit) };
  },
  'documents.add': async (args, ctx) => addDocument(parseArgs(DocumentInput, args), ctx.user.id),
  'documents.list': async (args) => ({ documents: await listDocuments(parseArgs(ListArgs, args)) }),
  'documents.get': async (args) => getDocument(parseArgs(GetArgs, args)),
  'documents.delete': async (args) => deleteDocument(parseArgs(DeleteArgs, args).id),
} satisfies Record<string, ToolHandler>;

export type ToolName = keyof typeof toolHandlers;
