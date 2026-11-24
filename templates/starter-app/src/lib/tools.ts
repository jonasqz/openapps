import { parseArgs, type ToolHandler } from '@openapps/sdk';
import { z } from 'zod';
import { createItem, ItemInput, listItems } from './items';

/**
 * Die Tools dieser App, wie sie in `app.json` unter `offeredTools` stehen.
 * Agents rufen sie ueber den Plattform-MCP auf (`<app>__items__list`). Wer was
 * darf, prueft die Plattform vorher; hier steht kein Rechte-Code.
 *
 * Neue Tools: hier eintragen **und** in `app.json`, mit derselben Bezeichnung.
 */
const ItemsListArgs = z.object({ q: z.string().max(200).optional() }).strict();

export const toolHandlers: Readonly<Record<string, ToolHandler>> = {
  'items.list': async (args) => ({ items: await listItems(parseArgs(ItemsListArgs, args).q) }),
  'items.create': async (args) => ({ item: await createItem(parseArgs(ItemInput, args)) }),
};
