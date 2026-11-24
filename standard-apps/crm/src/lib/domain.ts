/**
 * Die festen Wertelisten des CRM. Dieselben Listen stehen als Check in
 * migrations/0001_crm.sql und als enum in openapi.yaml — aendert sich eine,
 * braucht es eine neue Migration und eine neue Spec, in dieser Reihenfolge.
 */

export const STAGES = ['lead', 'qualifiziert', 'angebot', 'gewonnen', 'verloren'] as const;
export type Stage = (typeof STAGES)[number];

/** Stages, in denen ein Deal noch offen ist. */
export const OPEN_STAGES: readonly Stage[] = ['lead', 'qualifiziert', 'angebot'];

export const STAGE_LABELS: Readonly<Record<Stage, string>> = {
  lead: 'Lead',
  qualifiziert: 'Qualifiziert',
  angebot: 'Angebot',
  gewonnen: 'Gewonnen',
  verloren: 'Verloren',
};

/**
 * Abschlusswahrscheinlichkeit je Stage in Prozent. Ganze Zahlen, damit die
 * Gewichtung in Cent exakt bleibt.
 */
export const STAGE_PROBABILITY: Readonly<Record<Stage, number>> = {
  lead: 10,
  qualifiziert: 25,
  angebot: 60,
  gewonnen: 100,
  verloren: 0,
};

export const ACTIVITY_KINDS = ['notiz', 'anruf', 'mail', 'termin'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const ACTIVITY_KIND_LABELS: Readonly<Record<ActivityKind, string>> = {
  notiz: 'Notiz',
  anruf: 'Anruf',
  mail: 'Mail',
  termin: 'Termin',
};

/** Hoechster Betrag in Cent: Number.MAX_SAFE_INTEGER, wie der Check in der DB. */
export const MAX_VALUE_CENTS = Number.MAX_SAFE_INTEGER;

export function isStage(value: unknown): value is Stage {
  return typeof value === 'string' && (STAGES as readonly string[]).includes(value);
}
