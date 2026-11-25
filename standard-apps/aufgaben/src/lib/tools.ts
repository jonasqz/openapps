import { parseArgs, type ToolHandler } from '@openapps/sdk';
import { createAufgabe, erledigeAufgabe, listAufgaben } from './aufgaben';
import { AufgabeCreateArgs, AufgabeErledigenArgs, AufgabenListArgs } from './schemas';

/**
 * Die Tools dieser App, wie sie in `app.json` unter `offeredTools` und als
 * `/tools/<name>` in openapi.yaml stehen. Agents rufen sie über den
 * Plattform-MCP auf (`aufgaben__aufgaben.list`). Wer was darf, prüft die
 * Plattform vorher; hier steht kein Rechte-Code.
 *
 * Die UI ruft dieselben Handler (src/app/actions.ts).
 */
export const toolHandlers = {
  'aufgaben.list': async (args) => ({
    aufgaben: await listAufgaben(parseArgs(AufgabenListArgs, args ?? {})),
  }),
  'aufgaben.create': async (args, { user }) => ({
    aufgabe: await createAufgabe(parseArgs(AufgabeCreateArgs, args), user.id),
  }),
  'aufgaben.erledigen': async (args, { user }) =>
    erledigeAufgabe(parseArgs(AufgabeErledigenArgs, args).id, user.id),
} satisfies Record<string, ToolHandler>;

export type ToolName = keyof typeof toolHandlers;

export const TOOL_NAMES = Object.keys(toolHandlers) as ToolName[];
