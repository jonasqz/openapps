import { z } from 'zod';

/** JJJJ-MM-TT und ein echtes Kalenderdatum (kein 2026-02-30). */
const DateString = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the date as YYYY-MM-DD, e.g. 2026-12-01.')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'This date does not exist. Enter the date as YYYY-MM-DD.');

export const TaskListArgs = z
  .object({
    completed: z.boolean().optional(),
    assignee: z.string().trim().min(1).max(200).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  })
  .strict();
export type TaskListArgs = z.infer<typeof TaskListArgs>;

export const TaskCreateArgs = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, 'Title is missing.')
      .max(200, 'Title can have at most 200 characters.'),
    assignee: z
      .string()
      .trim()
      .min(1, 'Assignee is missing.')
      .max(200, 'Assignee can have at most 200 characters.'),
    dueDate: DateString.optional(),
  })
  .strict();
export type TaskCreateArgs = z.infer<typeof TaskCreateArgs>;

export const TaskCompleteArgs = z
  .object({ id: z.string().uuid('id must be the UUID of a task from tasks.list.') })
  .strict();
export type TaskCompleteArgs = z.infer<typeof TaskCompleteArgs>;
