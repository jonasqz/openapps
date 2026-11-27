import { z } from 'zod';
import {
  ACTIVITY_KINDS,
  DEAL_STATUSES,
  MAX_VALUE_CENTS,
  needsReason,
  NEXT_STEP_STATUSES,
  REASON_REQUIRED,
  STAGES,
  type Stage,
} from './domain';

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
    .string({ required_error: 'is required', invalid_type_error: 'expected text' })
    .trim()
    .min(1, 'must not be empty')
    .max(max, `at most ${max} characters`);

const optionalText = (max: number) => z.preprocess(blankToUndefined, requiredText(max).optional());

/** Fuer Updates: fehlt = bleibt, null oder "" = loeschen. */
const clearableText = (max: number) =>
  z.preprocess(blankToNull, requiredText(max).nullable().optional());

export const uuid = z
  .string({ required_error: 'is required', invalid_type_error: 'expected a UUID as text' })
  .trim()
  .uuid('expected a UUID, e.g. from companies.list');

const optionalUuid = z.preprocess(blankToUndefined, uuid.optional());
const clearableUuid = z.preprocess(blankToNull, uuid.nullable().optional());

const limit = z
  .number({ invalid_type_error: 'expected a whole number' })
  .int('expected a whole number')
  .min(1, 'at least 1')
  .max(200, 'at most 200')
  .default(50);

const query = z.preprocess(
  blankToUndefined,
  z.string({ invalid_type_error: 'expected text' }).trim().max(200, 'at most 200 characters').optional(),
);

export const email = z
  .string({ invalid_type_error: 'expected text' })
  .trim()
  .max(254, 'at most 254 characters')
  .email('expected an email address like name@example.com');

export const phone = z
  .string({ invalid_type_error: 'expected text' })
  .trim()
  .min(1, 'must not be empty')
  .max(50, 'at most 50 characters')
  .regex(/^\+?(?=[^0-9]*[0-9])[0-9 ()/.-]+$/, 'expected a phone number made of digits, +, spaces, (, ), /, - and .');

/**
 * Website: ohne Schema wird `https://` ergaenzt. Nur http und https — eine
 * `javascript:`-URL landet sonst als Verweis in der Oberflaeche.
 */
export const website = z
  .string({ invalid_type_error: 'expected text' })
  .trim()
  .max(500, 'at most 500 characters')
  .transform((value) => (/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`))
  .refine((value) => {
    try {
      const url = new URL(value);
      return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname.includes('.');
    } catch {
      return false;
    }
  }, 'expected a web address like https://example.com');

/** Kalenderdatum JJJJ-MM-TT, das es wirklich gibt (kein 2025-02-30). */
export const isoDate = z
  .string({ invalid_type_error: 'expected a date as text' })
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected a date in the format YYYY-MM-DD')
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
  }, 'not a valid date');

export const valueCents = z
  .number({ required_error: 'is required', invalid_type_error: 'expected a whole number of cents' })
  .int('expected whole cents, e.g. 1250000 for €12,500')
  .min(0, 'must not be negative')
  .max(MAX_VALUE_CENTS, 'too large');

export const stage = z.enum(STAGES, {
  errorMap: () => ({ message: `expected one of: ${STAGES.join(', ')}` }),
});

export const activityKind = z.enum(ACTIVITY_KINDS, {
  errorMap: () => ({ message: `expected one of: ${ACTIVITY_KINDS.join(', ')}` }),
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
    industry: optionalText(100),
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
    message: `provide at least one of ${CONTACT_UPDATE_FIELDS.join(', ')}`,
  });
export type ContactUpdateArgs = z.infer<typeof ContactUpdateArgs>;

// --- Deals ----------------------------------------------------------------

export const dealStatus = z.enum(DEAL_STATUSES, {
  errorMap: () => ({ message: `expected one of: ${DEAL_STATUSES.join(', ')}` }),
});

export const DealsListArgs = z
  .object({
    q: query,
    stage: z.preprocess(blankToUndefined, stage.optional()),
    status: z.preprocess(blankToUndefined, dealStatus.optional()),
    companyId: optionalUuid,
    contactId: optionalUuid,
    owner: optionalText(200),
    limit,
  })
  .strict();
export type DealsListArgs = z.infer<typeof DealsListArgs>;

/**
 * Neue Deals starten offen. Won und lost brauchen einen Grund, und den nimmt
 * nur deals.update_stage an — so gibt es keinen Abschluss ohne Grund.
 */
export const openStage = z.enum(['lead', 'qualified', 'proposal'], {
  errorMap: () => ({
    message: 'expected one of: lead, qualified, proposal; create the deal open, then close it with deals.update_stage and a note',
  }),
}) satisfies z.ZodType<Stage>;

export const DealCreateArgs = z
  .object({
    title: requiredText(200),
    companyId: uuid,
    contactId: optionalUuid,
    valueCents,
    stage: z.preprocess(blankToUndefined, openStage.default('lead')),
    expectedClose: z.preprocess(blankToUndefined, isoDate.optional()),
    owner: optionalText(200),
  })
  .strict();
export type DealCreateArgs = z.infer<typeof DealCreateArgs>;

const DEAL_UPDATE_FIELDS = ['title', 'valueCents', 'expectedClose', 'owner', 'contactId'] as const;

/**
 * Bearbeiten ohne Stage: Die Stage aendert nur deals.update_stage, damit jeder
 * Wechsel im Verlauf steht. Ein `stage` hier ist ein unbekannter Schluessel.
 */
export const DealUpdateArgs = z
  .object({
    id: uuid,
    title: z.preprocess(blankToUndefined, requiredText(200).optional()),
    valueCents: valueCents.optional(),
    expectedClose: z.preprocess(blankToNull, isoDate.nullable().optional()),
    owner: clearableText(200),
    contactId: clearableUuid,
  })
  .strict()
  .refine((value) => DEAL_UPDATE_FIELDS.some((field) => value[field] !== undefined), {
    message: `provide at least one of ${DEAL_UPDATE_FIELDS.join(', ')}; the stage changes only through deals.update_stage`,
  });
export type DealUpdateArgs = z.infer<typeof DealUpdateArgs>;

/** Grund ist Pflicht bei won und lost (src/lib/stages.ts). */
export const DealUpdateStageArgs = z
  .object({ id: uuid, stage, note: optionalText(2000) })
  .strict()
  .superRefine((value, ctx) => {
    if (needsReason(value.stage) && value.note === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['note'], message: REASON_REQUIRED });
    }
  });
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
        .string({ invalid_type_error: 'expected a timestamp as text' })
        .datetime({ offset: true, message: 'expected an ISO timestamp like 2025-03-01T09:30:00Z' })
        .optional(),
    ),
  })
  .strict()
  .refine(
    (value) =>
      value.contactId !== undefined || value.companyId !== undefined || value.dealId !== undefined,
    { message: 'provide at least one of contactId, companyId, dealId' },
  );
export type ActivityLogArgs = z.infer<typeof ActivityLogArgs>;

export const ActivitiesListArgs = z
  .object({ contactId: optionalUuid, companyId: optionalUuid, dealId: optionalUuid, limit })
  .strict();
export type ActivitiesListArgs = z.infer<typeof ActivitiesListArgs>;

// --- Naechste Schritte ----------------------------------------------------

export const nextStepStatus = z.enum(NEXT_STEP_STATUSES, {
  errorMap: () => ({ message: `expected one of: ${NEXT_STEP_STATUSES.join(', ')}` }),
});

export const NextStepsListArgs = z
  .object({
    status: z.preprocess(blankToUndefined, nextStepStatus.default('open')),
    dealId: optionalUuid,
    companyId: optionalUuid,
    contactId: optionalUuid,
    owner: optionalText(200),
    limit,
  })
  .strict();
export type NextStepsListArgs = z.infer<typeof NextStepsListArgs>;

export const NextStepCreateArgs = z
  .object({
    title: requiredText(200),
    dueOn: isoDate,
    dealId: optionalUuid,
    companyId: optionalUuid,
    contactId: optionalUuid,
    owner: optionalText(200),
  })
  .strict()
  .refine(
    (value) =>
      value.dealId !== undefined || value.companyId !== undefined || value.contactId !== undefined,
    { message: 'provide at least one of dealId, companyId, contactId' },
  );
export type NextStepCreateArgs = z.infer<typeof NextStepCreateArgs>;

export const NextStepCompleteArgs = z.object({ id: uuid, note: optionalText(2000) }).strict();
export type NextStepCompleteArgs = z.infer<typeof NextStepCompleteArgs>;

// --- Pipeline -------------------------------------------------------------

export const PipelineSummaryArgs = z.object({}).strict();
