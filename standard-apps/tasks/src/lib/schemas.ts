import { z } from 'zod';
import { PRIORITIES, STATUSES } from './workflow';

/**
 * Die Eingaben der Tools. Jede Meldung geht an einen Agenten oder an ein
 * Formularfeld und muss sagen, wie es richtig geht. `.strict()` ueberall:
 * Ein unbekanntes Feld (etwa `createdBy`) ist ein Fehler, kein stilles Weglassen.
 */

/** JJJJ-MM-TT und ein echtes Kalenderdatum (kein 2026-02-30). */
const DateString = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the date as YYYY-MM-DD, e.g. 2026-12-01.')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'This date does not exist. Enter the date as YYYY-MM-DD.');

const TaskId = z.string().uuid('id must be the UUID of a task from tasks.list.');
const ProjectId = z.string().uuid('projectId must be the UUID of a project from projects.list.');

/**
 * Zuweisung per E-Mail-Adresse. Die Plattform gibt einer App kein
 * Personenverzeichnis; die E-Mail ist das, was `getUser` liefert, und damit
 * das, woran "My tasks" eine Person wiedererkennt. Klein geschrieben
 * gespeichert, damit der Vergleich nicht an der Schreibweise scheitert.
 */
const Assignee = z
  .string()
  .trim()
  .toLowerCase()
  .max(200, 'Assignee can have at most 200 characters.')
  .email('Assignee must be an email address, e.g. alex@example.com.');

const Title = z
  .string()
  .trim()
  .min(1, 'Title is missing.')
  .max(200, 'Title can have at most 200 characters.');

const Description = z.string().max(10000, 'Description can have at most 10000 characters.');

const StatusArg = z.enum(STATUSES, {
  errorMap: () => ({ message: `status must be one of ${STATUSES.join(', ')}.` }),
});

const PriorityArg = z.enum(PRIORITIES, {
  errorMap: () => ({ message: `priority must be one of ${PRIORITIES.join(', ')}.` }),
});

export const TaskListArgs = z
  .object({
    status: StatusArg.optional(),
    /** Kurzform: false = alles, was nicht Done ist; true = nur Done. */
    completed: z.boolean().optional(),
    mine: z.boolean().optional(),
    assignee: z.string().trim().toLowerCase().min(1).max(200).optional(),
    unassigned: z.boolean().optional(),
    overdue: z.boolean().optional(),
    projectId: ProjectId.optional(),
    query: z.string().trim().min(1).max(200).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  })
  .strict()
  .superRefine((args, ctx) => {
    const who = [args.mine === true, args.assignee !== undefined, args.unassigned === true];
    if (who.filter(Boolean).length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['assignee'],
        message: 'Use only one of mine, assignee and unassigned.',
      });
    }
    if (args.status !== undefined && args.completed !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['completed'],
        message: 'Use either status or completed, not both.',
      });
    }
  });
export type TaskListArgs = z.infer<typeof TaskListArgs>;

export const TaskGetArgs = z.object({ id: TaskId }).strict();
export type TaskGetArgs = z.infer<typeof TaskGetArgs>;

export const TaskCreateArgs = z
  .object({
    title: Title,
    description: Description.optional(),
    assignee: Assignee.optional(),
    dueDate: DateString.optional(),
    priority: PriorityArg.optional(),
    status: StatusArg.optional(),
    projectId: ProjectId.optional(),
  })
  .strict();
export type TaskCreateArgs = z.infer<typeof TaskCreateArgs>;

const PATCH_FIELDS = ['title', 'description', 'assignee', 'dueDate', 'priority', 'status', 'projectId'] as const;

export const TaskUpdateArgs = z
  .object({
    id: TaskId,
    title: Title.optional(),
    description: Description.optional(),
    assignee: Assignee.nullable().optional(),
    dueDate: DateString.nullable().optional(),
    priority: PriorityArg.optional(),
    status: StatusArg.optional(),
    projectId: ProjectId.nullable().optional(),
    /**
     * Schutz fuer Undo und gleichzeitiges Arbeiten: Der Status wird nur
     * geaendert, wenn er gerade noch dieser ist.
     */
    expectedStatus: StatusArg.optional(),
  })
  .strict()
  .superRefine((args, ctx) => {
    if (PATCH_FIELDS.every((field) => args[field] === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: `Nothing to change. Pass at least one of ${PATCH_FIELDS.join(', ')}.`,
      });
    }
  });
export type TaskUpdateArgs = z.infer<typeof TaskUpdateArgs>;

export const TaskAssignArgs = z
  .object({
    id: TaskId,
    /** E-Mail-Adresse, oder null, um die Zuweisung aufzuheben. */
    assignee: Assignee.nullable(),
  })
  .strict();
export type TaskAssignArgs = z.infer<typeof TaskAssignArgs>;

export const TaskCompleteArgs = z.object({ id: TaskId }).strict();
export type TaskCompleteArgs = z.infer<typeof TaskCompleteArgs>;

export const TaskCommentArgs = z
  .object({
    id: TaskId,
    body: z
      .string()
      .trim()
      .min(1, 'Comment is empty.')
      .max(5000, 'Comment can have at most 5000 characters.'),
  })
  .strict();
export type TaskCommentArgs = z.infer<typeof TaskCommentArgs>;

export const ProjectListArgs = z.object({}).strict();

/**
 * `search`, das Such-Tool fuer die Suche ueber alle Apps (ADR 0021): das feste
 * Format der Plattform (`parseSearchArgs` in `@openapps/sdk`).
 */
export const SearchArgs = z
  .object({
    query: z
      .string()
      .trim()
      .min(1, 'query must not be empty.')
      .max(200, 'query can have at most 200 characters.'),
    limit: z.number().int().min(1).max(20, 'limit can be at most 20.').default(5),
  })
  .strict();
export type SearchArgs = z.infer<typeof SearchArgs>;

export const ProjectCreateArgs = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Name is missing.')
      .max(100, 'Name can have at most 100 characters.'),
    description: z.string().trim().max(1000, 'Description can have at most 1000 characters.').optional(),
  })
  .strict();
export type ProjectCreateArgs = z.infer<typeof ProjectCreateArgs>;

/**
 * `tasks.create_from_ref` (ADR 0023 E): eine Aufgabe aus einem Objekt einer
 * anderen App. `sourceRef` ist der Verweis (`wiki:page:<id>`,
 * `crm:deal:<id>`), `excerpt` ein kurzer Auszug, der Beschreibung wird. Ohne
 * Titel nimmt die Aufgabe die erste Zeile des Auszugs.
 */
export const TaskFromRefArgs = z
  .object({
    sourceRef: z
      .string()
      .trim()
      .min(1, 'sourceRef is missing.')
      .max(400, 'sourceRef can have at most 400 characters.'),
    excerpt: z.string().max(2000, 'excerpt can have at most 2000 characters.').optional(),
    title: Title.optional(),
    assignee: Assignee.optional(),
    dueDate: DateString.optional(),
    priority: PriorityArg.optional(),
    status: StatusArg.optional(),
    projectId: ProjectId.optional(),
  })
  .strict();
export type TaskFromRefArgs = z.infer<typeof TaskFromRefArgs>;

/** `tasks.resolve`: das feste Format der Plattform (`parseResolveArgs` in `@openapps/sdk`). */
export const TaskResolveArgs = z
  .object({
    type: z.enum(['task', 'project'], {
      errorMap: () => ({ message: 'type must be task or project.' }),
    }),
    ids: z.array(z.string().min(1).max(128)).min(1).max(50, 'ids can have at most 50 entries.'),
  })
  .strict();
