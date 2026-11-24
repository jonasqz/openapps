import { parseArgs, type ToolHandler } from '@openapps/sdk';
import {
  archivePage,
  createPage,
  getPage,
  listPages,
  pageHistory,
  searchPages,
  updatePage,
} from './pages';
import {
  PagesArchiveArgs,
  PagesCreateArgs,
  PagesGetArgs,
  PagesHistoryArgs,
  PagesListArgs,
  PagesSearchArgs,
  PagesUpdateArgs,
} from './schemas';

/**
 * Die Tools des Wikis, ein Eintrag je `offeredTools`-Name in `app.json`.
 * Ein Test prueft, dass Manifest, `openapi.yaml` und diese Tabelle
 * deckungsgleich sind.
 *
 * Wer `ctx.user` ist, steht in der signierten Anfrage (Mensch: Id, Agent:
 * `agent:<name>`). Er landet in `created_by`/`updated_by` und im Verlauf.
 */
export const toolHandlers = {
  'pages.list': async (args) => listPages(parseArgs(PagesListArgs, args)),
  'pages.get': async (args) => getPage(parseArgs(PagesGetArgs, args)),
  'pages.search': async (args) => searchPages(parseArgs(PagesSearchArgs, args)),
  'pages.create': async (args, ctx) => createPage(parseArgs(PagesCreateArgs, args), ctx.user.id),
  'pages.update': async (args, ctx) => updatePage(parseArgs(PagesUpdateArgs, args), ctx.user.id),
  'pages.archive': async (args, ctx) => archivePage(parseArgs(PagesArchiveArgs, args), ctx.user.id),
  'pages.history': async (args) => pageHistory(parseArgs(PagesHistoryArgs, args)),
} satisfies Record<string, ToolHandler>;

export type ToolName = keyof typeof toolHandlers;

/** Die Argument-Schemas je Tool — fuer Tests und als Nachschlagewerk. */
export const toolSchemas = {
  'pages.list': PagesListArgs,
  'pages.get': PagesGetArgs,
  'pages.search': PagesSearchArgs,
  'pages.create': PagesCreateArgs,
  'pages.update': PagesUpdateArgs,
  'pages.archive': PagesArchiveArgs,
  'pages.history': PagesHistoryArgs,
} as const satisfies Record<ToolName, unknown>;
