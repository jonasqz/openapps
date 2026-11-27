import { z } from 'zod';

/**
 * Die Argumente der Tools. Dieselben Schemas pruefen die Tool-Route und die
 * Server Actions der UI — es gibt genau einen Weg, eine Seite zu schreiben.
 *
 * Alle Objekte sind `strict`: Ein Agent, der sich bei einem Argument vertippt
 * (`content` statt `contentMd`), bekommt einen Fehler statt einer stillen
 * Aenderung, die sein Argument ignoriert.
 */

export const LIMITS = {
  titleMax: 200,
  contentMax: 200_000,
  tagMax: 40,
  tagsMax: 20,
  queryMax: 200,
  searchLimitMax: 50,
  searchLimitDefault: 10,
  historyLimitMax: 200,
  historyLimitDefault: 50,
  listMax: 500,
  /** Hoechstzahl Knoten, die pages.tree auf einmal liefert. */
  treeMax: 500,
  /** Hoechstzahl Seitenlinks, die je Seite fuer Rueckverweise gespeichert werden. */
  linksMax: 500,
  /** Hoechstzahl Rueckverweise, die pages.get mitliefert. */
  backlinksMax: 100,
} as const;

export const PageId = z.string().uuid('expected a page id (UUID)');

export const Title = z
  .string()
  .trim()
  .min(1, 'Title must not be empty')
  .max(LIMITS.titleMax, `Title must have at most ${LIMITS.titleMax} characters`);

export const ContentMd = z
  .string()
  .max(LIMITS.contentMax, `Content must have at most ${LIMITS.contentMax} characters`);

/**
 * Ein Tag: klein geschrieben, ohne Leerzeichen am Rand. Buchstaben (auch
 * Umlaute), Ziffern, Bindestrich und Unterstrich.
 */
export const Tag = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Tag must not be empty')
  .max(LIMITS.tagMax, `Tag must have at most ${LIMITS.tagMax} characters`)
  .regex(/^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u, 'Tag: only letters, digits, - and _');

/** Tags ohne Dubletten, in der Reihenfolge der ersten Nennung. */
export const Tags = z
  .array(Tag)
  .max(LIMITS.tagsMax, `at most ${LIMITS.tagsMax} tags`)
  .transform((tags) => [...new Set(tags)]);

/**
 * `sort` und `limit` sind optional ohne Default, damit bestehende Aufrufer
 * (`listPages({})`) gueltig bleiben; der Default steht in `listPages`.
 */
export const PagesListArgs = z
  .object({
    q: z.string().trim().max(LIMITS.queryMax).optional(),
    parentId: PageId.optional(),
    tag: Tag.optional(),
    sort: z.enum(['title', 'updated'], {
      errorMap: () => ({ message: "sort must be 'title' or 'updated'" }),
    }).optional(),
    limit: z.number().int().min(1).max(LIMITS.listMax).optional(),
  })
  .strict();
export type PagesListArgs = z.infer<typeof PagesListArgs>;

export const PagesGetArgs = z.object({ id: PageId }).strict();
export type PagesGetArgs = z.infer<typeof PagesGetArgs>;

export const PagesSearchArgs = z
  .object({
    query: z
      .string()
      .trim()
      .min(1, 'Search text must not be empty')
      .max(LIMITS.queryMax, `Search text must have at most ${LIMITS.queryMax} characters`),
    limit: z
      .number()
      .int()
      .min(1)
      .max(LIMITS.searchLimitMax)
      .default(LIMITS.searchLimitDefault),
  })
  .strict();
export type PagesSearchArgs = z.infer<typeof PagesSearchArgs>;

export const PagesCreateArgs = z
  .object({
    title: Title,
    contentMd: ContentMd,
    parentId: PageId.optional(),
    tags: Tags.default([]),
  })
  .strict();
export type PagesCreateArgs = z.infer<typeof PagesCreateArgs>;

export const PagesUpdateArgs = z
  .object({
    id: PageId,
    title: Title.optional(),
    contentMd: ContentMd.optional(),
    tags: Tags.optional(),
    appendMd: z
      .string()
      .min(1, 'appendMd must not be empty')
      .max(LIMITS.contentMax, `appendMd must have at most ${LIMITS.contentMax} characters`)
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.contentMd !== undefined && value.appendMd !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['appendMd'],
        message: 'contentMd replaces, appendMd appends — pass only one of them',
      });
    }
    if (
      value.title === undefined &&
      value.contentMd === undefined &&
      value.tags === undefined &&
      value.appendMd === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: 'nothing to change: pass at least one of title, contentMd, appendMd, tags',
      });
    }
  });
export type PagesUpdateArgs = z.infer<typeof PagesUpdateArgs>;

export const PagesArchiveArgs = z.object({ id: PageId }).strict();
export type PagesArchiveArgs = z.infer<typeof PagesArchiveArgs>;

export const PagesHistoryArgs = z
  .object({
    id: PageId,
    limit: z
      .number()
      .int()
      .min(1)
      .max(LIMITS.historyLimitMax)
      .default(LIMITS.historyLimitDefault),
  })
  .strict();
export type PagesHistoryArgs = z.infer<typeof PagesHistoryArgs>;

/**
 * `parentId` ist Pflicht, damit die Absicht eindeutig ist: `null` heisst
 * „nach oben“, nicht „vergessen“.
 */
export const PagesMoveArgs = z
  .object({
    id: PageId,
    // `null` heisst oberste Ebene. Fehlt das Feld, meldet zod „Required“.
    parentId: PageId.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.parentId === value.id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['parentId'],
        message: 'A page cannot be its own parent',
      });
    }
  });
export type PagesMoveArgs = z.infer<typeof PagesMoveArgs>;

export const PagesTreeArgs = z
  .object({
    rootId: PageId.optional(),
  })
  .strict();
export type PagesTreeArgs = z.infer<typeof PagesTreeArgs>;

/**
 * Revisionen haben eine fortlaufende Nummer (bigint). Als Zeichenkette, weil
 * JSON-Zahlen ab 2^53 ungenau werden; `pages.history` liefert sie ebenso.
 */
export const RevisionId = z
  .string()
  .regex(/^[1-9]\d{0,17}$/, 'expected a revision id from pages.history (digits as a string)');

export const PagesRestoreArgs = z
  .object({
    id: PageId,
    revisionId: RevisionId,
  })
  .strict();
export type PagesRestoreArgs = z.infer<typeof PagesRestoreArgs>;

export const FavoritesListArgs = z.object({}).strict();
export type FavoritesListArgs = z.infer<typeof FavoritesListArgs>;

export const FavoritesSetArgs = z
  .object({
    id: PageId,
    favorite: z.boolean({ required_error: 'favorite is required: true adds, false removes' }),
  })
  .strict();
export type FavoritesSetArgs = z.infer<typeof FavoritesSetArgs>;

/**
 * Tags aus einem Formularfeld: durch Komma getrennt. Leere Stuecke fallen weg,
 * den Rest prueft `Tags`.
 */
export function splitTags(raw: string): string[] {
  return raw
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '');
}
