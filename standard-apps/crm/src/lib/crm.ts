import { ToolInputError, ToolNotFoundError } from '@openapps/sdk';
import { query, withTransaction, type Query } from './db';
import { CLOSED_STAGES, OPEN_STAGES, type ActivityKind, type Stage } from './domain';
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
  DealUpdateArgs,
  DealUpdateStageArgs,
  NextStepCompleteArgs,
  NextStepCreateArgs,
  NextStepsListArgs,
} from './schemas';
import { likePattern } from './search';
import { planStageChange } from './stages';

export { stageChangeSubject } from './stages';

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
  /** Zeitpunkt des Abschlusses (won/lost), sonst null. Pflegt die Datenbank. */
  closedAt: string | null;
  /** Grund fuer won/lost; null bei offenen Deals und bei Altbestand. */
  closeReason: string | null;
  /** Der frueheste offene naechste Schritt am Deal, sonst null. */
  nextStep: DealNextStep | null;
  createdAt: string;
  updatedAt: string;
}

export interface DealNextStep {
  id: string;
  title: string;
  /** JJJJ-MM-TT. */
  dueOn: string;
  overdue: boolean;
}

export interface NextStep {
  id: string;
  title: string;
  /** JJJJ-MM-TT. */
  dueOn: string;
  /** Offen und vor heute (Europe/Berlin) faellig. */
  overdue: boolean;
  dealId: string | null;
  dealTitle: string | null;
  companyId: string | null;
  companyName: string | null;
  contactId: string | null;
  contactName: string | null;
  owner: string | null;
  doneAt: string | null;
  doneBy: string | null;
  createdBy: string;
  createdAt: string;
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
  closed_at: Date | null;
  close_reason: string | null;
  next_step_id: string | null;
  next_step_title: string | null;
  next_step_due_on: string | null;
  next_step_overdue: boolean | null;
  created_at: Date;
  updated_at: Date;
}

interface NextStepRow extends Record<string, unknown> {
  id: string;
  title: string;
  due_on: string;
  overdue: boolean;
  deal_id: string | null;
  deal_title: string | null;
  company_id: string | null;
  company_name: string | null;
  contact_id: string | null;
  contact_name: string | null;
  owner: string | null;
  done_at: Date | null;
  done_by: string | null;
  created_by: string;
  created_at: Date;
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
  closedAt: row.closed_at === null ? null : row.closed_at.toISOString(),
  closeReason: row.close_reason,
  nextStep:
    row.next_step_id === null || row.next_step_title === null || row.next_step_due_on === null
      ? null
      : {
          id: row.next_step_id,
          title: row.next_step_title,
          dueOn: row.next_step_due_on,
          overdue: row.next_step_overdue === true,
        },
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

const toNextStep = (row: NextStepRow): NextStep => ({
  id: row.id,
  title: row.title,
  dueOn: row.due_on,
  overdue: row.overdue,
  dealId: row.deal_id,
  dealTitle: row.deal_title,
  companyId: row.company_id,
  companyName: row.company_name,
  contactId: row.contact_id,
  contactName: row.contact_name,
  owner: row.owner,
  doneAt: row.done_at === null ? null : row.done_at.toISOString(),
  doneBy: row.done_by,
  createdBy: row.created_by,
  createdAt: row.created_at.toISOString(),
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

/**
 * Der heutige Kalendertag in Europe/Berlin, dieselbe Zeitzone wie die Anzeige
 * (src/lib/format.ts). Ein Schritt "heute faellig" ist noch nicht ueberfaellig.
 */
const TODAY = `(now() at time zone 'Europe/Berlin')::date`;

const DEAL_SELECT = `
  select d.id, d.title, d.company_id, c.name as company_name, d.contact_id, p.name as contact_name,
         d.value_cents::text as value_cents, d.stage,
         to_char(d.expected_close, 'YYYY-MM-DD') as expected_close,
         d.owner, d.closed_at, d.close_reason,
         ns.id as next_step_id, ns.title as next_step_title,
         to_char(ns.due_on, 'YYYY-MM-DD') as next_step_due_on,
         (ns.due_on < ${TODAY}) as next_step_overdue,
         d.created_at, d.updated_at
    from deals d
    join companies c on c.id = d.company_id
    left join contacts p on p.id = d.contact_id
    left join lateral (
      select s.id, s.title, s.due_on
        from next_steps s
       where s.deal_id = d.id and s.done_at is null
       order by s.due_on, s.created_at, s.id
       limit 1
    ) ns on true`;

const NEXT_STEP_SELECT = `
  select s.id, s.title, to_char(s.due_on, 'YYYY-MM-DD') as due_on,
         (s.done_at is null and s.due_on < ${TODAY}) as overdue,
         s.deal_id, d.title as deal_title,
         s.company_id, c.name as company_name,
         s.contact_id, p.name as contact_name,
         s.owner, s.done_at, s.done_by, s.created_by, s.created_at
    from next_steps s
    left join deals d on d.id = s.deal_id
    left join companies c on c.id = s.company_id
    left join contacts p on p.id = s.contact_id`;

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
const CLOSED_STAGE_LIST = CLOSED_STAGES.map((stage) => `'${stage}'`).join(', ');

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
  next_steps_deal_id_fkey: { field: 'dealId', message: 'This deal does not exist.' },
  next_steps_company_id_fkey: { field: 'companyId', message: 'This company does not exist.' },
  next_steps_contact_id_fkey: { field: 'contactId', message: 'This contact does not exist.' },
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
  /** Offene naechste Schritte der Firma, ihrer Kontakte und Deals. */
  nextSteps: NextStep[];
}

export async function getCompany(id: string): Promise<CompanyDetail> {
  const company = await getCompanyById(id);
  if (company === null) throw new ToolNotFoundError('Company not found.');
  const [contacts, deals, activities, nextSteps] = await Promise.all([
    listContacts({ companyId: id, limit: 200 }),
    listDeals({ companyId: id, limit: 200 }),
    listActivities({ companyId: id, limit: 20 }),
    listNextSteps({ companyId: id, status: 'open', limit: 200 }),
  ]);
  return { company, contacts, deals, activities, nextSteps };
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
  /** Offene naechste Schritte am Kontakt. */
  nextSteps: NextStep[];
}

export async function getContact(id: string): Promise<ContactDetail> {
  const contact = await getContactById(query, id);
  if (contact === null) throw new ToolNotFoundError('Contact not found.');
  const [deals, activities, nextSteps] = await Promise.all([
    listDeals({ contactId: id, limit: 200 }),
    listActivities({ contactId: id, limit: 20 }),
    listNextSteps({ contactId: id, status: 'open', limit: 200 }),
  ]);
  return { contact, deals, activities, nextSteps };
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
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (value: unknown, clause: (p: string) => string): void => {
    params.push(value);
    where.push(clause(`$${params.length}`));
  };
  if (args.q !== undefined) {
    add(likePattern(args.q), (p) => `(d.title ilike ${p} or c.name ilike ${p} or p.name ilike ${p})`);
  }
  if (args.stage !== undefined) add(args.stage, (p) => `d.stage = ${p}`);
  if (args.status === 'open') where.push(`d.stage in (${OPEN_STAGE_LIST})`);
  if (args.status === 'closed') where.push(`d.stage in (${CLOSED_STAGE_LIST})`);
  if (args.companyId !== undefined) add(args.companyId, (p) => `d.company_id = ${p}`);
  if (args.contactId !== undefined) add(args.contactId, (p) => `d.contact_id = ${p}`);
  if (args.owner !== undefined) add(args.owner, (p) => `d.owner = ${p}`);
  params.push(args.limit);
  const rows = await query<DealRow>(
    `${DEAL_SELECT}
      ${where.length === 0 ? '' : `where ${where.join(' and ')}`}
      order by d.expected_close asc nulls last, d.created_at desc, d.id
      limit $${params.length}`,
    params,
  );
  return rows.map(toDeal);
}

async function getDealById(q: Query, id: string): Promise<Deal | null> {
  const rows = await q<DealRow>(`${DEAL_SELECT} where d.id = $1`, [id]);
  const row = rows[0];
  return row === undefined ? null : toDeal(row);
}

/** Ein Kontakt am Deal muss existieren und zur Firma des Deals gehoeren. */
async function assertContactFitsCompany(contactId: string, companyId: string): Promise<void> {
  const contact = await getContactById(query, contactId);
  if (contact === null) {
    const message = 'This contact does not exist.';
    throw new ToolInputError(message, [{ path: ['contactId'], message }]);
  }
  if (contact.companyId !== null && contact.companyId !== companyId) {
    const message = `The contact belongs to a different company (${contact.companyName ?? contact.companyId}).`;
    throw new ToolInputError(message, [{ path: ['contactId'], message }]);
  }
}

export async function createDeal(args: DealCreateArgs, callerId: string): Promise<Deal> {
  if (args.contactId !== undefined) await assertContactFitsCompany(args.contactId, args.companyId);

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

export interface DealDetail {
  deal: Deal;
  activities: Activity[];
  nextSteps: NextStep[];
}

export async function getDeal(id: string): Promise<DealDetail> {
  const deal = await getDealById(query, id);
  if (deal === null) throw new ToolNotFoundError('Deal not found.');
  const [activities, nextSteps] = await Promise.all([
    listActivities({ dealId: id, limit: 50 }),
    listNextSteps({ dealId: id, status: 'all', limit: 200 }),
  ]);
  return { deal, activities, nextSteps };
}

const DEAL_COLUMN_OF: Readonly<Record<string, string>> = {
  title: 'title',
  valueCents: 'value_cents',
  expectedClose: 'expected_close',
  owner: 'owner',
  contactId: 'contact_id',
};

/** Bearbeitet einen Deal ohne Stage. Die Stage aendert nur updateDealStage. */
export async function updateDeal(args: DealUpdateArgs): Promise<Deal> {
  const current = await getDealById(query, args.id);
  if (current === null) throw new ToolNotFoundError('Deal not found.');
  if (typeof args.contactId === 'string') await assertContactFitsCompany(args.contactId, current.companyId);

  const sets: string[] = [];
  const params: unknown[] = [args.id];
  for (const [field, column] of Object.entries(DEAL_COLUMN_OF)) {
    const value = args[field as keyof DealUpdateArgs];
    if (value === undefined) continue;
    params.push(value);
    // Spaltennamen kommen aus der festen Liste oben, nie aus der Eingabe.
    const cast = column === 'expected_close' ? '::date' : '';
    sets.push(`${column} = $${params.length}${cast}`);
  }
  if (sets.length === 0) throw new ToolInputError('Nothing to change.');

  return translated(async () => {
    const rows = await query<{ id: string }>(
      `update deals set ${sets.join(', ')} where id = $1 returning id`,
      params,
    );
    firstOrThrow(rows, 'Deal');
    const deal = await getDealById(query, args.id);
    if (deal === null) throw new ToolNotFoundError('Deal not found.');
    return deal;
  });
}

export interface StageChange {
  deal: Deal;
  changed: boolean;
  activity: Activity | null;
}

/**
 * Setzt die Stage und schreibt im selben Zug die Aktivitaet. Beides in einer
 * Transaktion: ein Stage-Wechsel ohne Eintrag im Verlauf darf es nicht geben.
 * `for update` haelt zwei gleichzeitige Wechsel auseinander, sonst stuende im
 * Verlauf zweimal dieselbe alte Stage.
 *
 * Die Regeln (Grund bei won/lost, kein Eintrag bei gleicher Stage) stehen in
 * src/lib/stages.ts; closed_at setzt der Trigger aus 0003_deal_close.sql.
 */
export async function updateDealStage(
  args: DealUpdateStageArgs,
  callerId: string,
): Promise<StageChange> {
  return translated(() =>
    withTransaction(async (q) => {
      const current = await q<{ stage: Stage; company_id: string; contact_id: string | null }>(
        'select stage, company_id, contact_id from deals where id = $1 for update',
        [args.id],
      );
      const row = firstOrThrow(current, 'Deal');
      const plan = planStageChange(row.stage, args.stage, args.note);

      if (!plan.changed) {
        const deal = await getDealById(q, args.id);
        if (deal === null) throw new ToolNotFoundError('Deal not found.');
        return { deal, changed: false, activity: null };
      }

      await q('update deals set stage = $2, close_reason = $3 where id = $1', [
        args.id,
        args.stage,
        plan.closeReason,
      ]);
      const inserted = await q<{ id: string }>(
        `insert into activities (kind, subject, body, contact_id, company_id, deal_id, created_by)
         values ('note', $1, $2, $3, $4, $5, $6)
         returning id`,
        [plan.subject, args.note ?? null, row.contact_id, row.company_id, args.id, callerId],
      );
      const activityId = firstOrThrow(inserted, 'Activity').id;

      const deal = await getDealById(q, args.id);
      if (deal === null) throw new ToolNotFoundError('Deal not found.');
      const activities = await q<ActivityRow>(`${ACTIVITY_SELECT} where a.id = $1`, [activityId]);
      return { deal, changed: true, activity: toActivity(firstOrThrow(activities, 'Activity')) };
    }),
  );
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

/**
 * Firma eines Eintrags: angegeben, sonst vom Deal, sonst vom Kontakt. So
 * erscheint er im Verlauf der Firma, auch wenn der Aufrufer sie nicht nennt.
 * Ein unbekannter Deal oder Kontakt ist ein 404.
 */
async function companyFor(
  q: Query,
  companyId: string | undefined,
  dealId: string | undefined,
  contactId: string | undefined,
): Promise<string | null> {
  if (companyId !== undefined) return companyId;
  if (dealId !== undefined) {
    const deal = firstOrThrow(
      await q<{ company_id: string }>('select company_id from deals where id = $1', [dealId]),
      'Deal',
    );
    return deal.company_id;
  }
  if (contactId !== undefined) {
    const contact = firstOrThrow(
      await q<{ company_id: string | null }>('select company_id from contacts where id = $1', [contactId]),
      'Contact',
    );
    return contact.company_id;
  }
  return null;
}

export async function logActivity(args: ActivityLogArgs, callerId: string): Promise<Activity> {
  return translated(() =>
    withTransaction(async (q) => {
      const companyId = await companyFor(q, args.companyId, args.dealId, args.contactId);

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

// --- Naechste Schritte -----------------------------------------------------

export async function listNextSteps(args: NextStepsListArgs): Promise<NextStep[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (args.status === 'open') where.push('s.done_at is null');
  if (args.status === 'overdue') where.push(`s.done_at is null and s.due_on < ${TODAY}`);
  if (args.status === 'done') where.push('s.done_at is not null');
  if (args.dealId !== undefined) {
    params.push(args.dealId);
    where.push(`s.deal_id = $${params.length}`);
  }
  if (args.contactId !== undefined) {
    params.push(args.contactId);
    where.push(`s.contact_id = $${params.length}`);
  }
  if (args.owner !== undefined) {
    params.push(args.owner);
    where.push(`s.owner = $${params.length}`);
  }
  if (args.companyId !== undefined) {
    params.push(args.companyId);
    const p = `$${params.length}`;
    // Wie bei den Aktivitaeten: auch Schritte an Deals und Kontakten der Firma.
    where.push(`(s.company_id = ${p}
                 or s.deal_id in (select id from deals where company_id = ${p})
                 or s.contact_id in (select id from contacts where company_id = ${p}))`);
  }
  params.push(args.limit);
  // Offene zuerst, nach Faelligkeit; erledigte danach, zuletzt erledigte oben.
  const rows = await query<NextStepRow>(
    `${NEXT_STEP_SELECT}
      ${where.length === 0 ? '' : `where ${where.join(' and ')}`}
      order by (s.done_at is not null),
               case when s.done_at is null then s.due_on end asc,
               s.done_at desc, s.created_at, s.id
      limit $${params.length}`,
    params,
  );
  return rows.map(toNextStep);
}

async function getNextStepById(q: Query, id: string): Promise<NextStep | null> {
  const rows = await q<NextStepRow>(`${NEXT_STEP_SELECT} where s.id = $1`, [id]);
  const row = rows[0];
  return row === undefined ? null : toNextStep(row);
}

export async function createNextStep(args: NextStepCreateArgs, callerId: string): Promise<NextStep> {
  return translated(() =>
    withTransaction(async (q) => {
      const companyId = await companyFor(q, args.companyId, args.dealId, args.contactId);
      const inserted = await q<{ id: string }>(
        `insert into next_steps (title, due_on, deal_id, company_id, contact_id, owner, created_by)
         values ($1, $2::date, $3, $4, $5, $6, $7)
         returning id`,
        [
          args.title,
          args.dueOn,
          args.dealId ?? null,
          companyId,
          args.contactId ?? null,
          args.owner ?? callerId,
          callerId,
        ],
      );
      const step = await getNextStepById(q, firstOrThrow(inserted, 'Next step').id);
      if (step === null) throw new Error('Next step not readable after create');
      return step;
    }),
  );
}

export interface NextStepChange {
  nextStep: NextStep;
  changed: boolean;
  activity: Activity | null;
}

/** Betreff der Aktivitaet beim Erledigen oder Wiedereroeffnen, hoechstens 200 Zeichen. */
export function nextStepSubject(prefix: 'Done' | 'Reopened', title: string): string {
  const subject = `${prefix}: ${title}`;
  return subject.length <= 200 ? subject : `${subject.slice(0, 199)}…`;
}

/**
 * Erledigt (`done = true`) oder oeffnet einen Schritt wieder und schreibt im
 * selben Zug einen Eintrag in den Verlauf. Ist der Schritt schon im
 * Zielzustand, aendert sich nichts (`changed: false`) — ein wiederholter
 * Aufruf erzeugt keinen zweiten Eintrag.
 */
export async function setNextStepDone(
  id: string,
  done: boolean,
  note: string | undefined,
  callerId: string,
): Promise<NextStepChange> {
  return translated(() =>
    withTransaction(async (q) => {
      const current = firstOrThrow(
        await q<{
          title: string;
          done_at: Date | null;
          deal_id: string | null;
          company_id: string | null;
          contact_id: string | null;
        }>(
          'select title, done_at, deal_id, company_id, contact_id from next_steps where id = $1 for update',
          [id],
        ),
        'Next step',
      );

      if ((current.done_at !== null) === done) {
        const step = await getNextStepById(q, id);
        if (step === null) throw new ToolNotFoundError('Next step not found.');
        return { nextStep: step, changed: false, activity: null };
      }

      await q(
        done
          ? 'update next_steps set done_at = now(), done_by = $2 where id = $1'
          : 'update next_steps set done_at = null, done_by = null where id = $1',
        done ? [id, callerId] : [id],
      );
      const inserted = await q<{ id: string }>(
        `insert into activities (kind, subject, body, contact_id, company_id, deal_id, created_by)
         values ('note', $1, $2, $3, $4, $5, $6)
         returning id`,
        [
          nextStepSubject(done ? 'Done' : 'Reopened', current.title),
          note ?? null,
          current.contact_id,
          current.company_id,
          current.deal_id,
          callerId,
        ],
      );
      const activities = await q<ActivityRow>(`${ACTIVITY_SELECT} where a.id = $1`, [
        firstOrThrow(inserted, 'Activity').id,
      ]);
      const step = await getNextStepById(q, id);
      if (step === null) throw new ToolNotFoundError('Next step not found.');
      return {
        nextStep: step,
        changed: true,
        activity: toActivity(firstOrThrow(activities, 'Activity')),
      };
    }),
  );
}

export const completeNextStep = (args: NextStepCompleteArgs, callerId: string) =>
  setNextStepDone(args.id, true, args.note, callerId);

export const reopenNextStep = (id: string, callerId: string) =>
  setNextStepDone(id, false, undefined, callerId);

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
