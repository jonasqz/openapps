import { z } from 'zod';

/**
 * Die Argumente der Tools. Dieselben Schemas pruefen die Eingaben aus der UI
 * (Server Actions) — es gibt keinen zweiten Weg mit eigenen Regeln.
 *
 * `strict()`: Ein unbekanntes Feld ist ein Fehler, keine Stille. Ein Agent,
 * der `text` statt `content` schickt, soll das erfahren, statt ein leeres
 * Dokument anzulegen.
 */

export const TITLE_MAX = 200;
export const SOURCE_MAX = 500;
export const CONTENT_MAX = 200_000;
export const QUERY_MAX = 500;
export const SEARCH_LIMIT_DEFAULT = 5;
export const SEARCH_LIMIT_MAX = 20;

export const SearchArgs = z
  .object({
    query: z.string().trim().min(1, 'query must not be empty').max(QUERY_MAX),
    limit: z.number().int().min(1).max(SEARCH_LIMIT_MAX).default(SEARCH_LIMIT_DEFAULT),
  })
  .strict();
export type SearchArgs = z.infer<typeof SearchArgs>;

export const DocumentInput = z
  .object({
    title: z.string().trim().min(1, 'title must not be empty').max(TITLE_MAX),
    // Nicht getrimmt: der Text bleibt, wie er kam. Leer heisst nur Leerraum.
    content: z
      .string()
      .max(CONTENT_MAX)
      .refine((value) => value.trim() !== '', 'content must not be empty'),
    // Leer oder null heisst: keine Quelle.
    source: z
      .string()
      .trim()
      .max(SOURCE_MAX)
      .nullish()
      .transform((value) => (value === undefined || value === null || value === '' ? null : value)),
  })
  .strict();
export type DocumentInput = z.infer<typeof DocumentInput>;

export const ListArgs = z
  .object({
    q: z.string().trim().max(200).optional(),
  })
  .strict();
export type ListArgs = z.infer<typeof ListArgs>;

const documentId = z.string().uuid('id is not a UUID');

export const GetArgs = z
  .object({
    id: documentId,
    includeChunks: z.boolean().default(false),
  })
  .strict();
export type GetArgs = z.infer<typeof GetArgs>;

export const DeleteArgs = z.object({ id: documentId }).strict();
export type DeleteArgs = z.infer<typeof DeleteArgs>;
