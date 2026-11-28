import { actorOf, createEventOutbox, recipientOf, type PlatformEventInput } from '@openapps/sdk';
import { query, withTransaction, type Query } from './db';

/**
 * Was das CRM der Plattform meldet (ADR 0022), so wie es in `app.json` unter
 * `events` steht:
 *
 * - `deal.won`, `deal.lost`: ein Deal wurde geschlossen; an seinen Besitzer.
 * - `next_step.assigned`: ein naechster Schritt fuer jemand anderen geplant;
 *   an diese Person.
 * - `next_step.due`: ein offener Schritt ist heute faellig oder ueberfaellig
 *   (Europe/Berlin); an seine Person, einmal je Faelligkeitstag.
 *
 * Wer davon eine Benachrichtigung bekommt, entscheidet die Plattform: nur,
 * wer das CRM lesen darf, und nie der Ausloeser. Hier steht kein Rechte-Code.
 */

export const CRM_EVENT_TYPES = ['deal.won', 'deal.lost', 'next_step.assigned', 'next_step.due'] as const;

export const crmEvents = createEventOutbox({ query, name: '[crm] events' });

/** Reiht Ereignisse ein. Nur in der Transaktion der Aenderung. */
export async function emitCrmEvents(q: Query, events: readonly PlatformEventInput[]): Promise<void> {
  if (events.length === 0) return;
  await crmEvents.emit(q, events);
}

/** Nach dem Commit: liefern, ohne zu warten. Wirft nie. */
export function kickEvents(): void {
  crmEvents.kick();
}

const audienceOf = (value: string | null): string[] => {
  const recipient = recipientOf(value);
  return recipient === null ? [] : [recipient];
};

/** `activityId` ist der Eintrag im Verlauf zum Abschluss: eindeutig, also die Id. */
export function dealClosedEvent(
  deal: { id: string; title: string; owner: string | null },
  stage: 'won' | 'lost',
  activityId: string,
  callerId: string,
): PlatformEventInput {
  return {
    id: `deal.${stage}:${activityId}`,
    type: stage === 'won' ? 'deal.won' : 'deal.lost',
    object: `deal:${deal.id}`,
    title: `Deal ${stage}: ${deal.title}`,
    path: `/deals/${deal.id}`,
    actor: actorOf(callerId),
    audience: audienceOf(deal.owner),
  };
}

export interface StepRef {
  id: string;
  title: string;
  dueOn: string;
  owner: string | null;
  dealId: string | null;
  companyId: string | null;
  contactId: string | null;
}

/** Ein Schritt hat keine eigene Seite: der Link fuehrt zu seinem Deal, sonst zur Firma oder Person. */
export function stepPath(step: Pick<StepRef, 'dealId' | 'companyId' | 'contactId'>): string {
  if (step.dealId !== null) return `/deals/${step.dealId}`;
  if (step.companyId !== null) return `/companies/${step.companyId}`;
  if (step.contactId !== null) return `/contacts/${step.contactId}`;
  return '/';
}

export function stepAssignedEvent(step: StepRef, callerId: string): PlatformEventInput | null {
  if (step.owner === null || step.owner === callerId) return null;
  const audience = audienceOf(step.owner);
  if (audience.length === 0) return null;
  return {
    id: `next_step.assigned:${step.id}`,
    type: 'next_step.assigned',
    object: `next_step:${step.id}`,
    title: `Next step for you: ${step.title} (due ${step.dueOn})`,
    path: stepPath(step),
    actor: actorOf(callerId),
    audience,
  };
}

export function stepDueEvent(step: StepRef): PlatformEventInput | null {
  const audience = audienceOf(step.owner);
  if (audience.length === 0) return null;
  return {
    id: `next_step.due:${step.id}:${step.dueOn}`,
    type: 'next_step.due',
    object: `next_step:${step.id}`,
    title: `Due ${step.dueOn}: ${step.title}`,
    path: stepPath(step),
    actor: null,
    audience,
  };
}

interface DueRow extends Record<string, unknown> {
  id: string;
  title: string;
  due_on: string;
  owner: string | null;
  deal_id: string | null;
  company_id: string | null;
  contact_id: string | null;
}

/**
 * Meldet offene Schritte, die heute oder frueher faellig sind und fuer
 * diesen Tag noch nicht gemeldet wurden. Markierung und Outbox in einer
 * Transaktion; zwei Instanzen gleichzeitig melden nichts doppelt
 * (`for update skip locked`). Gibt die Zahl zurueck.
 */
export async function emitDueNextSteps(limit = 200): Promise<number> {
  const count = await withTransaction(async (q) => {
    const rows = await q<DueRow>(
      `select s.id, s.title, to_char(s.due_on, 'YYYY-MM-DD') as due_on, s.owner,
              s.deal_id, s.company_id, s.contact_id
         from next_steps s
        where s.done_at is null and s.owner is not null
          and s.due_on <= (now() at time zone 'Europe/Berlin')::date
          and not exists (
            select 1 from next_step_due_notices n
             where n.next_step_id = s.id and n.due_on = s.due_on)
        order by s.due_on, s.id
        limit $1
          for update of s skip locked`,
      [limit],
    );
    const events = rows.flatMap((row) => {
      const event = stepDueEvent({
        id: row.id,
        title: row.title,
        dueOn: row.due_on,
        owner: row.owner,
        dealId: row.deal_id,
        companyId: row.company_id,
        contactId: row.contact_id,
      });
      return event === null ? [] : [event];
    });
    await emitCrmEvents(q, events);
    if (rows.length > 0) {
      await q(
        `insert into next_step_due_notices (next_step_id, due_on)
         select id, due_on from next_steps where id = any($1::uuid[])
         on conflict do nothing`,
        [rows.map((row) => row.id)],
      );
    }
    return rows.length;
  });
  if (count > 0) kickEvents();
  return count;
}

let dueTimer: ReturnType<typeof setInterval> | null = null;

/** Beim Start: Outbox liefern und stuendlich nach Faelligem sehen. Wirft nie. */
export function startCrmEvents(intervalMs = 60 * 60 * 1000): void {
  crmEvents.start();
  const check = (): void => {
    void emitDueNextSteps().catch((error: unknown) => {
      console.warn(`[crm] due next steps: ${error instanceof Error ? error.name : 'error'}`);
    });
  };
  check();
  if (dueTimer !== null) return;
  dueTimer = setInterval(check, intervalMs);
  dueTimer.unref?.();
}
