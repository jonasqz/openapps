import { z } from 'zod';

/** JJJJ-MM-TT und ein echtes Kalenderdatum (kein 2026-02-30). */
const Datum = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum als JJJJ-MM-TT angeben, z. B. 2026-12-01.')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Das Datum gibt es nicht. Datum als JJJJ-MM-TT angeben.');

export const AufgabenListArgs = z
  .object({
    erledigt: z.boolean().optional(),
    zustaendig: z.string().trim().min(1).max(200).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  })
  .strict();
export type AufgabenListArgs = z.infer<typeof AufgabenListArgs>;

export const AufgabeCreateArgs = z
  .object({
    titel: z.string().trim().min(1, 'Titel fehlt.').max(200, 'Titel höchstens 200 Zeichen.'),
    zustaendig: z
      .string()
      .trim()
      .min(1, 'Zuständige Person fehlt.')
      .max(200, 'Zuständige Person höchstens 200 Zeichen.'),
    faelligAm: Datum.optional(),
  })
  .strict();
export type AufgabeCreateArgs = z.infer<typeof AufgabeCreateArgs>;

export const AufgabeErledigenArgs = z
  .object({ id: z.string().uuid('id muss die UUID einer Aufgabe aus aufgaben.list sein.') })
  .strict();
export type AufgabeErledigenArgs = z.infer<typeof AufgabeErledigenArgs>;
