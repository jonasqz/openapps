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

/**
 * `documents.search`, das Such-Tool fuer die Suche ueber alle Apps (ADR 0021).
 * Dieselben Grenzen wie das feste Format der Plattform (`parseSearchArgs` in
 * `@openapps/sdk`): Suchtext bis 200 Zeichen, 1 bis 20 Treffer.
 */
export const DOCUMENT_SEARCH_QUERY_MAX = 200;
export const DocumentSearchArgs = z
  .object({
    query: z.string().trim().min(1, 'query must not be empty').max(DOCUMENT_SEARCH_QUERY_MAX),
    limit: z.number().int().min(1).max(SEARCH_LIMIT_MAX).default(SEARCH_LIMIT_DEFAULT),
  })
  .strict();
export type DocumentSearchArgs = z.infer<typeof DocumentSearchArgs>;

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

/* -------------------------------------------------------------------------- */
/* Inhalte anderer Apps (ADR 0020)                                             */
/* -------------------------------------------------------------------------- */

export const SOURCE_KEY_MAX = 200;
export const SOURCE_PATH_MAX = 500;

/**
 * Schluessel in der Quell-App, etwa die Seiten-Id. Nur Zeichen, die in einer
 * Id vorkommen; dieselbe Regel steht als Check in der Migration 0002.
 */
const sourceKey = z
  .string()
  .trim()
  .min(1, 'key must not be empty')
  .max(SOURCE_KEY_MAX)
  .regex(/^[A-Za-z0-9._:/-]+$/, 'key may only contain letters, digits and . _ : / -');

/**
 * Pfad in der Quell-App fuer den Link zurueck: beginnt mit `/`, bleibt in der
 * Quell-App. Kein Schema, kein `//` am Anfang (das waere eine fremde Domain),
 * keine `.`- oder `..`-Segmente, die aus der Quell-App herausfuehren.
 */
export const SourcePath = z
  .string()
  .trim()
  .max(SOURCE_PATH_MAX)
  .regex(/^\/[A-Za-z0-9._~%/?=&#:@+,-]*$/, 'path must start with / and stay inside the app')
  .refine((value) => !value.startsWith('//'), 'path must not start with //')
  .refine(
    (value) => !/(^|\/)\.\.?(\/|$|\?|#)/.test(value),
    'path must not contain . or .. segments',
  );

export const UpsertArgs = z
  .object({
    key: sourceKey,
    title: z.string().trim().min(1, 'title must not be empty').max(TITLE_MAX),
    content: z
      .string()
      .max(CONTENT_MAX)
      .refine((value) => value.trim() !== '', 'content must not be empty'),
    // Frei lesbare Herkunft, die mit dem Treffer erscheint, etwa der Pfad der
    // Seite im Wiki. Nicht die Quell-App: die kommt aus der Identitaet.
    source: z
      .string()
      .trim()
      .max(SOURCE_MAX)
      .nullish()
      .transform((value) => (value === undefined || value === null || value === '' ? null : value)),
    path: SourcePath.nullish().transform((value) => value ?? null),
    // Stand in der Quell-App. Ein aelterer Stand ueberschreibt keinen neueren.
    updatedAt: z
      .string()
      .datetime({ offset: true, message: 'updatedAt must be an ISO 8601 timestamp' })
      .nullish()
      .transform((value) => value ?? null),
  })
  .strict();
export type UpsertArgs = z.infer<typeof UpsertArgs>;

export const RemoveArgs = z.object({ key: sourceKey }).strict();
export type RemoveArgs = z.infer<typeof RemoveArgs>;
