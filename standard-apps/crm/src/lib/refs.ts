import {
  actorOf,
  createRefsOutbox,
  ownRef,
  parseResolveArgs,
  refTargetsFromText,
  type ResolvedObject,
  type ResolveToolResult,
  type SetRefsInput,
} from '@openapps/sdk';
import { query, type Query } from './db';
import { STAGE_LABELS, type Stage } from './domain';

/**
 * Verweise zwischen Apps (ADR 0023), die Seite des CRM:
 *
 * - **Resolver** `crm.resolve` fuer `company`, `contact`, `deal` und die
 *   beiden Quellen von Verweisen, `activity` (Notiz, Anruf …) und
 *   `next-step`. Die Plattform ruft ihn erst, nachdem sie geprueft hat, dass
 *   der Betrachter das CRM lesen darf; hier steht kein Rechte-Code.
 * - **Ausgehende Verweise**: `@{…}` in Betreff und Text einer Aktivitaet und
 *   im Titel eines naechsten Schritts. Beides aendert sich nach dem Anlegen
 *   nicht, gemeldet wird also beim Anlegen, wenn es Verweise gibt.
 */

export const CRM_OBJECT_TYPES = ['company', 'contact', 'deal', 'activity', 'next-step'] as const;
export type CrmObjectType = (typeof CRM_OBJECT_TYPES)[number];

export const crmRefs = createRefsOutbox({ query, name: '[crm] refs' });

/** Nach dem Commit: liefern, ohne zu warten. Wirft nie. */
export function kickRefs(): void {
  crmRefs.kick();
}

export const crmRef = (type: CrmObjectType, id: string): string => ownRef('crm', type, id).ref;

/** Seite eines Eintrags: der Deal, sonst der Kontakt, sonst die Firma. */
export function subjectPath(row: {
  deal_id: string | null;
  contact_id: string | null;
  company_id: string | null;
}): string {
  if (row.deal_id !== null) return `/deals/${encodeURIComponent(row.deal_id)}`;
  if (row.contact_id !== null) return `/contacts/${encodeURIComponent(row.contact_id)}`;
  if (row.company_id !== null) return `/companies/${encodeURIComponent(row.company_id)}`;
  return '/';
}

/** Die Meldung fuer eine Quelle des CRM. Rein, fuer Tests. */
export function crmRefsReport(input: {
  type: 'activity' | 'next-step';
  id: string;
  title: string;
  texts: readonly (string | null)[];
  path: string;
  updatedAt: Date;
  actor: string;
}): SetRefsInput {
  return {
    source: crmRef(input.type, input.id),
    targets: refTargetsFromText(...input.texts),
    updatedAt: input.updatedAt,
    title: input.title,
    path: input.path,
    actor: actorOf(input.actor),
  };
}

/** Hat einer der Texte Verweise? */
export function hasRefs(...texts: readonly (string | null | undefined)[]): boolean {
  return refTargetsFromText(...texts).length > 0;
}

/** Reiht die Verweise einer Aktivitaet ein, wenn sie welche hat. Nur in der Transaktion. */
export async function reportActivityRefs(q: Query, id: string, actor: string): Promise<void> {
  const [row] = await q<{
    subject: string;
    body: string | null;
    deal_id: string | null;
    contact_id: string | null;
    company_id: string | null;
    updated_at: Date;
  }>(
    'select subject, body, deal_id, contact_id, company_id, updated_at from activities where id = $1',
    [id],
  );
  if (row === undefined || !hasRefs(row.subject, row.body)) return;
  await crmRefs.report(
    q,
    crmRefsReport({
      type: 'activity',
      id,
      title: row.subject,
      texts: [row.subject, row.body],
      path: subjectPath(row),
      updatedAt: row.updated_at,
      actor,
    }),
  );
}

/** Reiht die Verweise eines naechsten Schritts ein, wenn er welche hat. Nur in der Transaktion. */
export async function reportNextStepRefs(q: Query, id: string, actor: string): Promise<void> {
  const [row] = await q<{
    title: string;
    deal_id: string | null;
    contact_id: string | null;
    company_id: string | null;
    updated_at: Date;
  }>('select title, deal_id, contact_id, company_id, updated_at from next_steps where id = $1', [id]);
  if (row === undefined || !hasRefs(row.title)) return;
  await crmRefs.report(
    q,
    crmRefsReport({
      type: 'next-step',
      id,
      title: row.title,
      texts: [row.title],
      path: subjectPath(row),
      updatedAt: row.updated_at,
      actor,
    }),
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ResolveRow extends Record<string, unknown> {
  id: string;
  title: string;
  status: string | null;
  deal_id: string | null;
  contact_id: string | null;
  company_id: string | null;
  updated_at: Date;
}

/** Je Art eine feste Abfrage: Titel, Status und wohin der Link fuehrt. Kein Text vom Aufrufer im SQL. */
const RESOLVE_SQL: Readonly<Record<CrmObjectType, string>> = {
  company: `select id::text as id, name as title, null::text as status,
                   null::uuid as deal_id, null::uuid as contact_id, id as company_id, updated_at
              from companies where id = any ($1::uuid[])`,
  contact: `select id::text as id, name as title, null::text as status,
                   null::uuid as deal_id, id as contact_id, null::uuid as company_id, updated_at
              from contacts where id = any ($1::uuid[])`,
  deal: `select id::text as id, title, stage as status,
                id as deal_id, null::uuid as contact_id, null::uuid as company_id, updated_at
           from deals where id = any ($1::uuid[])`,
  activity: `select id::text as id, subject as title, null::text as status,
                    deal_id, contact_id, company_id, updated_at
               from activities where id = any ($1::uuid[])`,
  'next-step': `select id::text as id, title,
                       case when done_at is null then 'Open' else 'Done' end as status,
                       deal_id, contact_id, company_id, updated_at
                  from next_steps where id = any ($1::uuid[])`,
};

/** `crm.resolve`: Titel, Pfad und Status fuer die Chips anderer Apps. */
export async function resolveCrmObjects(q: Query, args: unknown): Promise<ResolveToolResult> {
  const { type, ids } = parseResolveArgs(args, CRM_OBJECT_TYPES);
  const valid = ids.filter((id) => UUID.test(id));
  if (valid.length === 0) return { objects: [] };
  const rows = await q<ResolveRow>(RESOLVE_SQL[type as CrmObjectType], [valid]);
  return {
    objects: rows.map((row): ResolvedObject => {
      const status =
        type === 'deal' && row.status !== null && row.status in STAGE_LABELS
          ? STAGE_LABELS[row.status as Stage]
          : row.status;
      return {
        id: row.id,
        title: row.title,
        path: subjectPath(row),
        ...(status === null ? {} : { status }),
        updatedAt: row.updated_at.toISOString(),
      };
    }),
  };
}
