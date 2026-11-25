import { parseArgs, type ToolHandler } from '@openapps/sdk';
import { completeTask, createTask, listTasks } from './tasks';
import { TaskCompleteArgs, TaskCreateArgs, TaskListArgs } from './schemas';

/**
 * Die Tools dieser App, wie sie in `app.json` unter `offeredTools` und als
 * `/tools/<name>` in openapi.yaml stehen. Agents rufen sie über den
 * Plattform-MCP auf (`tasks__tasks__list`). Wer was darf, prüft die
 * Plattform vorher; hier steht kein Rechte-Code.
 *
 * Die UI ruft dieselben Handler (src/app/actions.ts).
 */
export const toolHandlers = {
  'tasks.list': async (args) => ({
    tasks: await listTasks(parseArgs(TaskListArgs, args ?? {})),
  }),
  'tasks.create': async (args, { user }) => ({
    task: await createTask(parseArgs(TaskCreateArgs, args), user.id),
  }),
  'tasks.complete': async (args, { user }) =>
    completeTask(parseArgs(TaskCompleteArgs, args).id, user.id),
} satisfies Record<string, ToolHandler>;

export type ToolName = keyof typeof toolHandlers;

export const TOOL_NAMES = Object.keys(toolHandlers) as ToolName[];
