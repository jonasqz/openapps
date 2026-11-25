import { ToolInputError, ToolNotFoundError } from '@openapps/sdk';
import { query, withTransaction, type Query } from './db';
import { OPEN_STAGES, STAGE_LABELS, type ActivityKind, type Stage } from './domain';
import { summarizePipeline, type PipelineSummary, type StageAggregate } from './pipeline';
import type {
  ActivitiesListArgs,
  ActivityLogArgs,
  CompaniesListArgs,
  CompanyCreateArgs,
  ContactCreateArgs,
  ContactsListArgs,
  ContactUpdateArgs,
  DealCreateArgs,
  DealsListArgs,
  DealUpdateStageArgs,
} from './schemas';
import { likePattern } from './search';

/**
 * Datenzugriff des CRM. Jede Funktion bekommt schon gepruefte Argumente (aus
 * src/lib/schemas.ts) und liefert die Form, die in openapi.yaml steht.
 *
 * Kein Rechte-Code: Wer was darf, hat das Gateway bzw. der Plattform-MCP vor
 * dem Aufruf entschieden. Hier geht es nur noch um Fachlichkeit.
 */

// --- Formen nach aussen -----------------------------------------------------

export interface Company {
  id: string;
  name: string;
  website: string | null;
  industry: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CompanyListItem extends Company {
  contactCount: number;
  openDealCount: number;
}

export interface Contact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  companyId: string | null;
  companyName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Deal {
  id: string;
  title: string;
  companyId: string;
  companyName: string;
  contactId: string | null;
  contactName: string | null;
  valueCents: number;
  stage: Stage;
  /** JJJJ-MM-TT oder null. */
  expectedClose: string | null;
  owner: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Activity {
  id: string;
  kind: ActivityKind;
  subject: string;
  body: string | null;
  contactId: string | null;
  contactName: string | null;
  companyId: string | null;
  companyName: string | null;
  dealId: string | null;
  dealTitle: string | null;
  happenedAt: string;
  createdBy: string;
  createdAt: string;
}

// --- Zeilen aus der Datenbank -----------------------------------------------

interface CompanyRow extends Record<string, unknown> {
  id: string;
  name: string;
  website: string | null;
  industry: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

interface CompanyListRow extends CompanyRow {
  contact_count: number;
  open_deal_count: number;
}

interface ContactRow extends Record<string, unknown> {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  company_id: string | null;
  company_name: string | null;
  created_at: Date;
  updated_at: Date;
}

interface DealRow extends Record<string, unknown> {
  id: string;
  title: string;
  company_id: string;
  company_name: string;
  contact_id: string | null;
  contact_name: string | null;
  /** bigint kommt von `pg` als Text. */
  value_cents: string;
  stage: Stage;
  expected_close: string | null;
  owner: string | null;
  created_at: Date;
  updated_at: Date;
}

interface ActivityRow extends Record<string, unknown> {
  id: string;
  kind: ActivityKind;
  subject: string;
  body: string | null;
  contact_id: string | null;
  contact_name: string | null;
  company_id: string | null;
  company_name: string | null;
  deal_id: string | null;
  deal_title: string | null;
  happened_at: Date;
  created_by: string;
  created_at: Date;
}

const toCompany = (row: CompanyRow): Company => ({
  id: row.id,
  name: row.name,
  website: row.website,
  industry: row.industry,
  notes: row.notes,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

const toContact = (row: ContactRow): Contact => ({
  id: row.id,
  name: row.name,
  email: row.email,
  phone: row.phone,
  role: row.role,
  companyId: row.company_id,
  companyName: row.company_name,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

const toDeal = (row: DealRow): Deal => ({
  id: row.id,
  title: row.title,
  companyId: row.company_id,
  companyName: row.company_name,
  contactId: row.contact_id,
  contactName: row.contact_name,
  // Der Check in der DB haelt den Betrag unter Number.MAX_SAFE_INTEGER.
  valueCents: Number(row.value_cents),
  stage: row.stage,
  expectedClose: row.expected_close,
  owner: row.owner,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

const toActivity = (row: ActivityRow): Activity => ({
  id: row.id,
  kind: row.kind,
  subject: row.subject,
  body: row.body,
  contactId: row.contact_id,
  contactName: row.contact_name,
  companyId: row.company_id,
  companyName: row.company_name,
  dealId: row.deal_id,
  dealTitle: row.deal_title,
  happenedAt: row.happened_at.toISOString(),
  createdBy: row.created_by,
  createdAt: row.created_at.toISOString(),
});

const COMPANY_COLUMNS = 'c.id, c.name, c.website, c.industry, c.notes, c.created_at, c.updated_at';

const CONTACT_SELECT = `
  select p.id, p.name, p.email, p.phone, p.role, p.company_id, c.name as company_name,
         p.created_at, p.updated_at
    from contacts p
    left join companies c on c.id = p.company_id`;

const DEAL_SELECT = `
  select d.id, d.title, d.company_id, c.name as company_name, d.contact_id, p.name as contact_name,
         d.value_cents::text as value_cents, d.stage,
         to_char(d.expected_close, 'YYYY-MM-DD') as expected_close,
         d.owner, d.created_at, d.updated_at
    from deals d
    join companies c on c.id = d.company_id
    left join contacts p on p.id = d.contact_id`;

const ACTIVITY_SELECT = `
  select a.id, a.kind, a.subject, a.body,
         a.contact_id, p.name as contact_name,
         a.company_id, c.name as company_name,
         a.deal_id, d.title as deal_title,
         a.happened_at, a.created_by, a.created_at
    from activities a
    left join contacts p on p.id = a.contact_id
    left join companies c on c.id = a.company_id
    left join deals d on d.id = a.deal_id`;

const OPEN_STAGE_LIST = OPEN_STAGES.map((stage) => `'${stage}'`).join(', ');

// --- Fehler der Datenbank in Meldungen fuer Aufrufer ------------------------

interface PgError {
  code?: unknown;
  constraint?: unknown;
}

/** Welcher Fremdschluessel auf welches Argument zeigt. */
const FOREIGN_KEY_FIELDS: Readonly<Record<string, { field: string; message: string }>> = {
  contacts_company_id_fkey: { field: 'companyId', message: 'This company does not exist.' },
  deals_company_id_fkey: { field: 'companyId', message: 'This company does not exist.' },
  deals_contact_id_fkey: { field: 'contactId', message: 'This contact does not exist.' },
  activities_company_id_fkey: { field: 'companyId', message: 'This company does not exist.' },
  activities_contact_id_fkey: { field: 'contactId', message: 'This contact does not exist.' },
  activities_deal_id_fkey: { field: 'dealId', message: 'This deal does not exist.' },
};

/**
 * Uebersetzt die Fehler, die ein Aufrufer selbst verursacht hat (doppelte
 * E-Mail, unbekannte Id), in einen `ToolInputError`. Alles andere bleibt ein
 * interner Fehler und geht nicht nach aussen.
 */
export function translateDbError(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) return error;
  const { code, constraint } = error as PgError;
  if (code === '23505' && constraint === 'contacts_email_key') {
    const message =
      'This email address already belongs to another contact. Find it with contacts.list (q = the email address).';
    return new ToolInputError(message, [{ path: ['email'], message }]);
  }
  if (code === '23503' && typeof constraint === 'string') {
    const target = FOREIGN_KEY_FIELDS[constraint];
    if (target !== undefined) {
      return new ToolInputError(target.message, [{ path: [target.field], message: target.message }]);
    }
  }
  if (code === '23514') {
    return new ToolInputError('A value breaks a database rule.', [
      { path: [], message: typeof constraint === 'string' ? constraint : 'check' },
    ]);
  }
  return error;
}

async function translated<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw translateDbError(error);
  }
}

function firstOrThrow<T>(rows: readonly T[], what: string): T {
  const row = rows[0];
  if (row === undefined) throw new ToolNotFoundError(`${what} not found.`);
  return row;
}

// --- Firmen -----------------------------------------------------------------

export async function listCompanies(args: CompaniesListArgs): Promise<CompanyListItem[]> {
  const rows = await query<CompanyListRow>(
    `select ${COMPANY_COLUMNS},
            (select count(*) from contacts p where p.company_id = c.id)::int as contact_count,
            (select count(*) from deals d
              where d.company_id = c.id and d.stage in (${OPEN_STAGE_LIST}))::int as open_deal_count
       from companies c
      where $1::text is null
         or c.name ilike $1 or c.industry ilike $1 or c.website ilike $1
      order by lower(c.name), c.id
      limit $2`,
    [args.q === undefined ? null : likePattern(args.q), args.limit],
  );
  return rows.map((row) => ({
    ...toCompany(row),
    contactCount: row.contact_count,
    openDealCount: row.open_deal_count,
  }));
}

export async function getCompanyById(id: string): Promise<Company | null> {
  const rows = await query<CompanyRow>(`select ${COMPANY_COLUMNS} from companies c where c.id = $1`, [
    id,
  ]);
  const row = rows[0];
  return row === undefined ? null : toCompany(row);
}

export interface CompanyDetail {
  company: Company;
  contacts: Contact[];
  deals: Deal[];
  activities: Activity[];
}

export async function getCompany(id: string): Promise<CompanyDetail> {
  const company = await getCompanyById(id);
  if (company === null) throw new ToolNotFoundError('Company not found.');
  const [contacts, deals, activities] = await Promise.all([
    listContacts({ companyId: id, limit: 200 }),
    listDeals({ companyId: id, limit: 200 }),
    listActivities({ companyId: id, limit: 20 }),
  ]);
  return { company, contacts, deals, activities };
}

export async function createCompany(args: CompanyCreateArgs): Promise<Company> {
  const rows = await translated(() =>
    query<CompanyRow>(
      `insert into companies as c (name, website, industry, notes) values ($1, $2, $3, $4)
       returning ${COMPANY_COLUMNS}`,
      [args.name, args.website ?? null, args.industry ?? null, args.notes ?? null],
    ),
  );
  return toCompany(firstOrThrow(rows, 'Company'));
}

// --- Kontakte ---------------------------------------------------------------

export async function listContacts(args: ContactsListArgs): Promise<Contact[]> {
  const rows = await query<ContactRow>(
    `${CONTACT_SELECT}
      where ($1::text is null
             or p.name ilike $1 or p.email ilike $1 or p.phone ilike $1 or p.role ilike $1)
        and ($2::uuid is null or p.company_id = $2)
      order by lower(p.name), p.id
      limit $3`,
    [args.q === undefined ? null : likePattern(args.q), args.companyId ?? null, args.limit],
  );
  return rows.map(toContact);
}

async function getContactById(q: Query, id: string): Promise<Contact | null> {
  const rows = await q<ContactRow>(`${CONTACT_SELECT} where p.id = $1`, [id]);
  const row = rows[0];
  return row === undefined ? null : toContact(row);
}

export interface ContactDetail {
  contact: Contact;
  deals: Deal[];
  activities: Activity[];
}

export async function getContact(id: string): Promise<ContactDetail> {
  const contact = await getContactById(query, id);
  if (contact === null) throw new ToolNotFoundError('Contact not found.');
  const [dealRows, activities] = await Promise.all([
    query<DealRow>(`${DEAL_SELECT} where d.contact_id = $1 order by d.created_at desc limit 200`, [id]),
    listActivities({ contactId: id, limit: 20 }),
  ]);
  return { contact, deals: dealRows.map(toDeal), activities };
}

export async function createContact(args: ContactCreateArgs): Promise<Contact> {
  return translated(async () => {
    const rows = await query<{ id: string }>(
      `insert into contacts (name, email, phone, role, company_id) values ($1, $2, $3, $4, $5)
       returning id`,
      [args.name, args.email ?? null, args.phone ?? null, args.role ?? null, args.companyId ?? null],
    );
    const { id } = firstOrThrow(rows, 'Contact');
    const contact = await getContactById(query, id);
    if (contact === null) throw new Error('Contact not readable after create');
    return contact;
  });
}

const CONTACT_COLUMN_OF: Readonly<Record<string, string>> = {
  name: 'name',
  email: 'email',
  phone: 'phone',
  role: 'role',
  companyId: 'company_id',
};

export async function updateContact(args: ContactUpdateArgs): Promise<Contact> {
  const sets: string[] = [];
  const params: unknown[] = [args.id];
  for (const [field, column] of Object.entries(CONTACT_COLUMN_OF)) {
    const value = args[field as keyof ContactUpdateArgs];
    if (value === undefined) continue;
    params.push(value);
    // Spaltennamen kommen aus der festen Liste oben, nie aus der Eingabe.
    sets.push(`${column} = $${params.length}`);
  }
  if (sets.length === 0) throw new ToolInputError('Nothing to change.');

  return translated(async () => {
    const rows = await query<{ id: string }>(
      `update contacts set ${sets.join(', ')} where id = $1 returning id`,
      params,
    );
    firstOrThrow(rows, 'Contact');
    const contact = await getContactById(query, args.id);
    if (contact === null) throw new ToolNotFoundError('Contact not found.');
    return contact;
  });
}

// --- Deals ------------------------------------------------------------------

export async function listDeals(args: DealsListArgs): Promise<Deal[]> {
  const rows = await query<DealRow>(
    `${DEAL_SELECT}
      where ($1::text is null or d.stage = $1)
        and ($2::uuid is null or d.company_id = $2)
      order by d.expected_close asc nulls last, d.created_at desc
      limit $3`,
    [args.stage ?? null, args.companyId ?? null, args.limit],
  );
  return rows.map(toDeal);
}

async function getDealById(q: Query, id: string): Promise<Deal | null> {
  const rows = await q<DealRow>(`${DEAL_SELECT} where d.id = $1`, [id]);
  const row = rows[0];
  return row === undefined ? null : toDeal(row);
}

export async function createDeal(args: DealCreateArgs, callerId: string): Promise<Deal> {
  if (args.contactId !== undefined) {
    const contact = await getContactById(query, args.contactId);
    if (contact === null) {
      const message = 'This contact does not exist.';
      throw new ToolInputError(message, [{ path: ['contactId'], message }]);
    }
    if (contact.companyId !== null && contact.companyId !== args.companyId) {
      const message = `The contact belongs to a different company (${contact.companyName ?? contact.companyId}).`;
      throw new ToolInputError(message, [{ path: ['contactId'], message }]);
    }
  }

  return translated(async () => {
    const rows = await query<{ id: string }>(
      `insert into deals (title, company_id, contact_id, value_cents, stage, expected_close, owner)
       values ($1, $2, $3, $4, $5, $6::date, $7)
       returning id`,
      [
        args.title,
        args.companyId,
        args.contactId ?? null,
        args.valueCents,
        args.stage,
        args.expectedClose ?? null,
        args.owner ?? callerId,
      ],
    );
    const { id } = firstOrThrow(rows, 'Deal');
    const deal = await getDealById(query, id);
    if (deal === null) throw new Error('Deal not readable after create');
    return deal;
  });
}

export interface StageChange {
  deal: Deal;
  changed: boolean;
  activity: Activity | null;
}

/** Text der automatischen Aktivitaet. Rein, damit er testbar ist. */
export function stageChangeSubject(from: Stage, to: Stage): string {
  return `Stage: ${STAGE_LABELS[from]} → ${STAGE_LABELS[to]}`;
}

/**
 * Setzt die Stage und schreibt im selben Zug die Aktivitaet. Beides in einer
 * Transaktion: ein Stage-Wechsel ohne Eintrag im Verlauf darf es nicht geben.
 * `for update` haelt zwei gleichzeitige Wechsel auseinander, sonst stuende im
 * Verlauf zweimal dieselbe alte Stage.
 */
export async function updateDealStage(
  args: DealUpdateStageArgs,
  callerId: string,
): Promise<StageChange> {
  return withTransaction(async (q) => {
    const current = await q<{ stage: Stage; company_id: string; contact_id: string | null }>(
      'select stage, company_id, contact_id from deals where id = $1 for update',
      [args.id],
    );
    const row = firstOrThrow(current, 'Deal');

    if (row.stage === args.stage) {
      const deal = await getDealById(q, args.id);
      if (deal === null) throw new ToolNotFoundError('Deal not found.');
      return { deal, changed: false, activity: null };
    }

    await q('update deals set stage = $2 where id = $1', [args.id, args.stage]);
    const inserted = await q<{ id: string }>(
      `insert into activities (kind, subject, body, contact_id, company_id, deal_id, created_by)
       values ('note', $1, $2, $3, $4, $5, $6)
       returning id`,
      [
        stageChangeSubject(row.stage, args.stage),
        args.note ?? null,
        row.contact_id,
        row.company_id,
        args.id,
        callerId,
      ],
    );
    const activityId = firstOrThrow(inserted, 'Activity').id;

    const deal = await getDealById(q, args.id);
    if (deal === null) throw new ToolNotFoundError('Deal not found.');
    const activities = await q<ActivityRow>(`${ACTIVITY_SELECT} where a.id = $1`, [activityId]);
    return { deal, changed: true, activity: toActivity(firstOrThrow(activities, 'Activity')) };
  });
}

// --- Aktivitaeten -----------------------------------------------------------

export async function listActivities(args: ActivitiesListArgs): Promise<Activity[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (args.contactId !== undefined) {
    params.push(args.contactId);
    where.push(`a.contact_id = $${params.length}`);
  }
  if (args.dealId !== undefined) {
    params.push(args.dealId);
    where.push(`a.deal_id = $${params.length}`);
  }
  if (args.companyId !== undefined) {
    params.push(args.companyId);
    const p = `$${params.length}`;
    // Auch, was an Kontakten oder Deals der Firma haengt und die Firma selbst
    // nicht nennt — sonst fehlt im Verlauf der Firma die Haelfte.
    where.push(`(a.company_id = ${p}
                 or a.deal_id in (select id from deals where company_id = ${p})
                 or a.contact_id in (select id from contacts where company_id = ${p}))`);
  }
  params.push(args.limit);
  const rows = await query<ActivityRow>(
    `${ACTIVITY_SELECT}
      ${where.length === 0 ? '' : `where ${where.join(' and ')}`}
      order by a.happened_at desc, a.id
      limit $${params.length}`,
    params,
  );
  return rows.map(toActivity);
}

export async function logActivity(args: ActivityLogArgs, callerId: string): Promise<Activity> {
  return translated(() =>
    withTransaction(async (q) => {
      let companyId = args.companyId ?? null;
      // Firma aus Deal oder Kontakt uebernehmen, damit die Aktivitaet im
      // Verlauf der Firma erscheint, auch wenn der Aufrufer sie nicht nennt.
      if (companyId === null && args.dealId !== undefined) {
        const deal = firstOrThrow(
          await q<{ company_id: string }>('select company_id from deals where id = $1', [args.dealId]),
          'Deal',
        );
        companyId = deal.company_id;
      }
      if (companyId === null && args.contactId !== undefined) {
        const contact = firstOrThrow(
          await q<{ company_id: string | null }>('select company_id from contacts where id = $1', [
            args.contactId,
          ]),
          'Contact',
        );
        companyId = contact.company_id;
      }

      const inserted = await q<{ id: string }>(
        `insert into activities (kind, subject, body, contact_id, company_id, deal_id, happened_at, created_by)
         values ($1, $2, $3, $4, $5, $6, coalesce($7::timestamptz, now()), $8)
         returning id`,
        [
          args.kind,
          args.subject,
          args.body ?? null,
          args.contactId ?? null,
          companyId,
          args.dealId ?? null,
          args.happenedAt ?? null,
          callerId,
        ],
      );
      const { id } = firstOrThrow(inserted, 'Activity');
      const rows = await q<ActivityRow>(`${ACTIVITY_SELECT} where a.id = $1`, [id]);
      return toActivity(firstOrThrow(rows, 'Activity'));
    }),
  );
}

// --- Pipeline ---------------------------------------------------------------

export async function pipelineSummary(): Promise<PipelineSummary> {
  const rows = await query<{ stage: string; count: number; sum_cents: string }>(
    `select stage, count(*)::int as count, coalesce(sum(value_cents), 0)::text as sum_cents
       from deals
      group by stage`,
  );
  const aggregates: StageAggregate[] = rows.map((row) => ({
    stage: row.stage,
    count: row.count,
    sumCents: row.sum_cents,
  }));
  return summarizePipeline(aggregates);
}
