/**
 * Die festen Wertelisten des CRM. Dieselben Listen stehen als Check in
 * migrations/0002_english_values.sql und als enum in openapi.yaml — aendert sich eine,
 * braucht es eine neue Migration und eine neue Spec, in dieser Reihenfolge.
 */

export const STAGES = ['lead', 'qualified', 'proposal', 'won', 'lost'] as const;
export type Stage = (typeof STAGES)[number];

/** Stages, in denen ein Deal noch offen ist. */
export const OPEN_STAGES: readonly Stage[] = ['lead', 'qualified', 'proposal'];

/** Stages, in denen ein Deal abgeschlossen ist; dort steht ein Grund. */
export const CLOSED_STAGES: readonly Stage[] = ['won', 'lost'];

export function isClosedStage(stage: Stage): boolean {
  return CLOSED_STAGES.includes(stage);
}

/** Braucht ein Wechsel nach `to` einen Grund? Nur der Abschluss. */
export function needsReason(to: Stage): boolean {
  return isClosedStage(to);
}

export const REASON_REQUIRED =
  'A reason is required when a deal is won or lost. Pass it as note, e.g. "Chose a cheaper provider".';

/** Filter `status` in deals.list: offen oder abgeschlossen. */
export const DEAL_STATUSES = ['open', 'closed'] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];

/**
 * Filter `status` in next_steps.list. `overdue` ist offen und vor dem
 * heutigen Tag (Europe/Berlin) faellig.
 */
export const NEXT_STEP_STATUSES = ['open', 'overdue', 'done', 'all'] as const;
export type NextStepStatus = (typeof NEXT_STEP_STATUSES)[number];

/** Beschriftungen fuer Menschen; die Werte oben sind API- und DB-Werte. */
export const STAGE_LABELS: Readonly<Record<Stage, string>> = {
  lead: 'Lead',
  qualified: 'Qualified',
  proposal: 'Proposal',
  won: 'Won',
  lost: 'Lost',
};

/**
 * Abschlusswahrscheinlichkeit je Stage in Prozent. Ganze Zahlen, damit die
 * Gewichtung in Cent exakt bleibt.
 */
export const STAGE_PROBABILITY: Readonly<Record<Stage, number>> = {
  lead: 10,
  qualified: 25,
  proposal: 60,
  won: 100,
  lost: 0,
};

export const ACTIVITY_KINDS = ['note', 'call', 'email', 'meeting'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const ACTIVITY_KIND_LABELS: Readonly<Record<ActivityKind, string>> = {
  note: 'Note',
  call: 'Call',
  email: 'Email',
  meeting: 'Meeting',
};

/** Hoechster Betrag in Cent: Number.MAX_SAFE_INTEGER, wie der Check in der DB. */
export const MAX_VALUE_CENTS = Number.MAX_SAFE_INTEGER;

export function isStage(value: unknown): value is Stage {
  return typeof value === 'string' && (STAGES as readonly string[]).includes(value);
}
