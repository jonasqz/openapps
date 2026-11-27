import { parseArgs, type ToolHandler } from '@openapps/sdk';
import { createProject, listProjects } from './projects';
import {
  ProjectCreateArgs,
  ProjectListArgs,
  TaskAssignArgs,
  TaskCommentArgs,
  TaskCompleteArgs,
  TaskCreateArgs,
  TaskGetArgs,
  TaskListArgs,
  TaskUpdateArgs,
} from './schemas';
import { addComment, createTask, getTask, listTasks, updateTask } from './tasks';
import { actorOf } from './workflow';

/**
 * Die Tools dieser App, wie sie in `app.json` unter `offeredTools` und als
 * `/tools/<name>` in openapi.yaml stehen. Agents rufen sie über den
 * Plattform-MCP auf (`tasks__tasks__list`). Wer was darf, prüft die
 * Plattform vorher; hier steht kein Rechte-Code.
 *
 * Die UI ruft dieselben Handler (src/app/actions.ts) — jeder Knopf hat sein Tool.
 */
export const toolHandlers = {
  'tasks.list': async (args, { user }) => ({
    tasks: await listTasks(parseArgs(TaskListArgs, args ?? {}), user.email),
  }),
  'tasks.get': async (args) => getTask(parseArgs(TaskGetArgs, args).id),
  'tasks.create': async (args, { user }) => ({
    task: await createTask(parseArgs(TaskCreateArgs, args), actorOf(user)),
  }),
  'tasks.update': async (args, { user }) => {
    const { id, expectedStatus, ...patch } = parseArgs(TaskUpdateArgs, args);
    return updateTask(id, patch, actorOf(user), expectedStatus);
  },
  'tasks.assign': async (args, { user }) => {
    const { id, assignee } = parseArgs(TaskAssignArgs, args);
    return updateTask(id, { assignee }, actorOf(user));
  },
  'tasks.complete': async (args, { user }) =>
    updateTask(parseArgs(TaskCompleteArgs, args).id, { status: 'done' }, actorOf(user)),
  'tasks.comment': async (args, { user }) => {
    const { id, body } = parseArgs(TaskCommentArgs, args);
    return { comment: await addComment(id, body, actorOf(user)) };
  },
  'projects.list': async (args) => {
    parseArgs(ProjectListArgs, args ?? {});
    return { projects: await listProjects() };
  },
  'projects.create': async (args, { user }) => ({
    project: await createProject(parseArgs(ProjectCreateArgs, args), actorOf(user)),
  }),
} satisfies Record<string, ToolHandler>;

export type ToolName = keyof typeof toolHandlers;

export const TOOL_NAMES = Object.keys(toolHandlers) as ToolName[];
