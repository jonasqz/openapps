import { z } from 'zod';
import { ACTIVITY_KINDS, MAX_VALUE_CENTS, STAGES } from './domain';

/**
 * Die Argumente jedes Tools. Jedes Schema ist `strict`: Ein unbekannter
 * Schluessel (etwa `company_id` statt `companyId`) ist ein Fehler mit Meldung,
 * kein still ignoriertes Feld — ein Agent soll merken, dass er sich vertan hat.
 *
 * Leerer Text gilt bei optionalen Feldern als "nicht angegeben". Das macht die
 * Formulare der UI und Agents, die "" schicken, gleich.
 */

const blankToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const blankToNull = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? null : value;

const requiredText = (max: number) =>
  z
    .string({ required_error: 'fehlt', invalid_type_error: 'erwartet Text' })
    .trim()
    .min(1, 'darf nicht leer sein')
    .max(max, `höchstens ${max} Zeichen`);

const optionalText = (max: number) => z.preprocess(blankToUndefined, requiredText(max).optional());

/** Fuer Updates: fehlt = bleibt, null oder "" = loeschen. */
const clearableText = (max: number) =>
  z.preprocess(blankToNull, requiredText(max).nullable().optional());

export const uuid = z
  .string({ required_error: 'fehlt', invalid_type_error: 'erwartet eine UUID als Text' })
  .trim()
  .uuid('erwartet eine UUID, z. B. aus companies.list');

const optionalUuid = z.preprocess(blankToUndefined, uuid.optional());
const clearableUuid = z.preprocess(blankToNull, uuid.nullable().optional());

const limit = z
  .number({ invalid_type_error: 'erwartet eine ganze Zahl' })
  .int('erwartet eine ganze Zahl')
  .min(1, 'mindestens 1')
  .max(200, 'höchstens 200')
  .default(50);

const query = z.preprocess(
  blankToUndefined,
  z.string({ invalid_type_error: 'erwartet Text' }).trim().max(200, 'höchstens 200 Zeichen').optional(),
);

export const email = z
  .string({ invalid_type_error: 'erwartet Text' })
  .trim()
  .max(254, 'höchstens 254 Zeichen')
  .email('erwartet eine E-Mail-Adresse wie name@example.com');

export const phone = z
  .string({ invalid_type_error: 'erwartet Text' })
  .trim()
  .min(1, 'darf nicht leer sein')
  .max(50, 'höchstens 50 Zeichen')
  .regex(/^\+?(?=[^0-9]*[0-9])[0-9 ()/.-]+$/, 'erwartet eine Telefonnummer aus Ziffern, +, Leerzeichen, (, ), /, - und .');

/**
 * Website: ohne Schema wird `https://` ergaenzt. Nur http und https — eine
 * `javascript:`-URL landet sonst als Verweis in der Oberflaeche.
 */
export const website = z
  .string({ invalid_type_error: 'erwartet Text' })
  .trim()
  .max(500, 'höchstens 500 Zeichen')
  .transform((value) => (/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`))
  .refine((value) => {
    try {
      const url = new URL(value);
      return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname.includes('.');
    } catch {
      return false;
    }
  }, 'erwartet eine Web-Adresse wie https://example.com');

/** Kalenderdatum JJJJ-MM-TT, das es wirklich gibt (kein 2025-02-30). */
export const isoDate = z
  .string({ invalid_type_error: 'erwartet ein Datum als Text' })
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'erwartet ein Datum im Format JJJJ-MM-TT')
  .refine((value) => {
    const [y, m, d] = value.split('-').map(Number) as [number, number, number];
    const date = new Date(Date.UTC(y, m - 1, d));
    return (
      date.getUTCFullYear() === y &&
      date.getUTCMonth() === m - 1 &&
      date.getUTCDate() === d &&
      y >= 1900 &&
      y <= 2200
    );
  }, 'kein gültiges Datum');

export const valueCents = z
  .number({ required_error: 'fehlt', invalid_type_error: 'erwartet eine ganze Zahl in Cent' })
  .int('erwartet ganze Cent, z. B. 1250000 für 12.500 €')
  .min(0, 'darf nicht negativ sein')
  .max(MAX_VALUE_CENTS, 'zu groß');

export const stage = z.enum(STAGES, {
  errorMap: () => ({ message: `erwartet eine von: ${STAGES.join(', ')}` }),
});

export const activityKind = z.enum(ACTIVITY_KINDS, {
  errorMap: () => ({ message: `erwartet eine von: ${ACTIVITY_KINDS.join(', ')}` }),
});

// --- Firmen ---------------------------------------------------------------

export const CompaniesListArgs = z.object({ q: query, limit }).strict();
export type CompaniesListArgs = z.infer<typeof CompaniesListArgs>;

export const IdArgs = z.object({ id: uuid }).strict();
export type IdArgs = z.infer<typeof IdArgs>;

export const CompanyCreateArgs = z
  .object({
    name: requiredText(200),
    website: z.preprocess(blankToUndefined, website.optional()),
    branche: optionalText(100),
    notes: optionalText(5000),
  })
  .strict();
export type CompanyCreateArgs = z.infer<typeof CompanyCreateArgs>;

// --- Kontakte -------------------------------------------------------------

export const ContactsListArgs = z.object({ q: query, companyId: optionalUuid, limit }).strict();
export type ContactsListArgs = z.infer<typeof ContactsListArgs>;

export const ContactCreateArgs = z
  .object({
    name: requiredText(200),
    email: z.preprocess(blankToUndefined, email.optional()),
    phone: z.preprocess(blankToUndefined, phone.optional()),
    role: optionalText(100),
    companyId: optionalUuid,
  })
  .strict();
export type ContactCreateArgs = z.infer<typeof ContactCreateArgs>;

const CONTACT_UPDATE_FIELDS = ['name', 'email', 'phone', 'role', 'companyId'] as const;

export const ContactUpdateArgs = z
  .object({
    id: uuid,
    name: z.preprocess(blankToUndefined, requiredText(200).optional()),
    email: z.preprocess(blankToNull, email.nullable().optional()),
    phone: z.preprocess(blankToNull, phone.nullable().optional()),
    role: clearableText(100),
    companyId: clearableUuid,
  })
  .strict()
  .refine((value) => CONTACT_UPDATE_FIELDS.some((field) => value[field] !== undefined), {
    message: `mindestens eines von ${CONTACT_UPDATE_FIELDS.join(', ')} angeben`,
  });
export type ContactUpdateArgs = z.infer<typeof ContactUpdateArgs>;

// --- Deals ----------------------------------------------------------------

export const DealsListArgs = z
  .object({ stage: z.preprocess(blankToUndefined, stage.optional()), companyId: optionalUuid, limit })
  .strict();
export type DealsListArgs = z.infer<typeof DealsListArgs>;

export const DealCreateArgs = z
  .object({
    title: requiredText(200),
    companyId: uuid,
    contactId: optionalUuid,
    valueCents,
    stage: z.preprocess(blankToUndefined, stage.default('lead')),
    expectedClose: z.preprocess(blankToUndefined, isoDate.optional()),
    owner: optionalText(200),
  })
  .strict();
export type DealCreateArgs = z.infer<typeof DealCreateArgs>;

export const DealUpdateStageArgs = z
  .object({ id: uuid, stage, note: optionalText(2000) })
  .strict();
export type DealUpdateStageArgs = z.infer<typeof DealUpdateStageArgs>;

// --- Aktivitaeten ---------------------------------------------------------

export const ActivityLogArgs = z
  .object({
    kind: activityKind,
    subject: requiredText(200),
    body: optionalText(10000),
    contactId: optionalUuid,
    companyId: optionalUuid,
    dealId: optionalUuid,
    happenedAt: z.preprocess(
      blankToUndefined,
      z
        .string({ invalid_type_error: 'erwartet einen Zeitpunkt als Text' })
        .datetime({ offset: true, message: 'erwartet einen ISO-Zeitpunkt wie 2025-03-01T09:30:00Z' })
        .optional(),
    ),
  })
  .strict()
  .refine(
    (value) =>
      value.contactId !== undefined || value.companyId !== undefined || value.dealId !== undefined,
    { message: 'mindestens eines von contactId, companyId, dealId angeben' },
  );
export type ActivityLogArgs = z.infer<typeof ActivityLogArgs>;

export const ActivitiesListArgs = z
  .object({ contactId: optionalUuid, companyId: optionalUuid, dealId: optionalUuid, limit })
  .strict();
export type ActivitiesListArgs = z.infer<typeof ActivitiesListArgs>;

// --- Pipeline -------------------------------------------------------------

export const PipelineSummaryArgs = z.object({}).strict();
