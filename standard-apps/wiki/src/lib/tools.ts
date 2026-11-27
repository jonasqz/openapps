import { parseArgs, type ToolHandler } from '@openapps/sdk';
import {
  archivePage,
  createPage,
  getPage,
  listFavorites,
  listPages,
  movePage,
  pageHistory,
  pageTree,
  restorePage,
  searchPages,
  setFavorite,
  updatePage,
} from './pages';
import {
  FavoritesListArgs,
  FavoritesSetArgs,
  PagesArchiveArgs,
  PagesCreateArgs,
  PagesGetArgs,
  PagesHistoryArgs,
  PagesListArgs,
  PagesMoveArgs,
  PagesRestoreArgs,
  PagesSearchArgs,
  PagesTreeArgs,
  PagesUpdateArgs,
} from './schemas';

/**
 * Die Tools des Wikis, ein Eintrag je `offeredTools`-Name in `app.json`.
 * Ein Test prueft, dass Manifest, `openapi.yaml` und diese Tabelle
 * deckungsgleich sind.
 *
 * Wer `ctx.user` ist, steht in der signierten Anfrage (Mensch: Id, Agent:
 * `agent:<name>`). Er landet in `created_by`/`updated_by`, im Verlauf und bei
 * den Favoriten als deren Besitzer.
 */
export const toolHandlers = {
  'pages.list': async (args) => listPages(parseArgs(PagesListArgs, args)),
  'pages.tree': async (args) => pageTree(parseArgs(PagesTreeArgs, args)),
  'pages.get': async (args) => getPage(parseArgs(PagesGetArgs, args)),
  'pages.search': async (args) => searchPages(parseArgs(PagesSearchArgs, args)),
  'pages.create': async (args, ctx) => createPage(parseArgs(PagesCreateArgs, args), ctx.user.id),
  'pages.update': async (args, ctx) => updatePage(parseArgs(PagesUpdateArgs, args), ctx.user.id),
  'pages.move': async (args, ctx) => movePage(parseArgs(PagesMoveArgs, args), ctx.user.id),
  'pages.archive': async (args, ctx) => archivePage(parseArgs(PagesArchiveArgs, args), ctx.user.id),
  'pages.history': async (args) => pageHistory(parseArgs(PagesHistoryArgs, args)),
  'pages.restore': async (args, ctx) => restorePage(parseArgs(PagesRestoreArgs, args), ctx.user.id),
  'favorites.list': async (args, ctx) => {
    parseArgs(FavoritesListArgs, args);
    return listFavorites(ctx.user.id);
  },
  'favorites.set': async (args, ctx) => setFavorite(parseArgs(FavoritesSetArgs, args), ctx.user.id),
} satisfies Record<string, ToolHandler>;

export type ToolName = keyof typeof toolHandlers;

/** Die Argument-Schemas je Tool — fuer Tests und als Nachschlagewerk. */
export const toolSchemas = {
  'pages.list': PagesListArgs,
  'pages.tree': PagesTreeArgs,
  'pages.get': PagesGetArgs,
  'pages.search': PagesSearchArgs,
  'pages.create': PagesCreateArgs,
  'pages.update': PagesUpdateArgs,
  'pages.move': PagesMoveArgs,
  'pages.archive': PagesArchiveArgs,
  'pages.history': PagesHistoryArgs,
  'pages.restore': PagesRestoreArgs,
  'favorites.list': FavoritesListArgs,
  'favorites.set': FavoritesSetArgs,
} as const satisfies Record<ToolName, unknown>;
