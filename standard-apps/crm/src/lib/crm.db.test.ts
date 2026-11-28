import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  runMigrations,
  runSeeds,
  ToolInputError,
  ToolNotFoundError,
  type PlatformUser,
} from '@openapps/sdk';

/**
 * Gegen ein echtes Postgres: Migrationen, Beispieldaten und die Tools mit
 * ihren Seiteneffekten. Laeuft nur, wenn CRM_TEST_DATABASE_URL und
 * CRM_TEST_DATABASE_SCHEMA gesetzt sind, sonst uebersprungen.
 *
 * Erwartet ein **leeres** Schema, das der Rolle gehoert (wie es
 * provision_app_schema anlegt), und eine Rolle ohne SUPERUSER und BYPASSRLS.
 * Der Test prueft das selbst.
 */

const url = process.env.CRM_TEST_DATABASE_URL ?? '';
const schema = process.env.CRM_TEST_DATABASE_SCHEMA ?? '';
const enabled = url !== '' && schema !== '';

const AGENT: PlatformUser = {
  id: 'agent:test',
  email: 'test@agents.invalid',
  groups: [],
  issuedAt: new Date(),
};

const STADTWERKE = '0a000000-0000-4000-8000-000000000001';
const HOLZBAU = '0a000000-0000-4000-8000-000000000002';
const KOEHLER = '0b000000-0000-4000-8000-000000000001';
const LINDNER = '0b000000-0000-4000-8000-000000000003';
const PORTAL = '0d000000-0000-4000-8000-000000000001';
const MAINTENANCE = '0d000000-0000-4000-8000-000000000002';
const SCHEDULING = '0d000000-0000-4000-8000-000000000003';
const STEP_PORTAL = '0e000000-0000-4000-8000-000000000001';

describe.skipIf(!enabled)('CRM against Postgres', () => {
  // Erst nach dem Setzen der Env laden: der Pool liest sie beim ersten Gebrauch.
  let db: typeof import('./db');
  let tools: (typeof import('./tools'))['toolHandlers'];

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.DATABASE_SCHEMA = schema;
    db = await import('./db');
    tools = (await import('./tools')).toolHandlers;
  });

  afterAll(async () => {
    await db?.appPool().end();
  });

  // Antworten als unknown: jeder Test sagt selbst, welche Form er erwartet.
  const run = (name: keyof typeof tools, args: unknown): Promise<unknown> =>
    tools[name](args, { user: AGENT });

  it('connects with a role without SUPERUSER and without BYPASSRLS', async () => {
    const rows = await db.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      'select rolsuper, rolbypassrls from pg_roles where rolname = current_user',
    );
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('applies migration and sample data, and nothing on the second run', async () => {
    const dir = join(process.cwd(), 'migrations');
    const seeds = join(process.cwd(), 'seeds');
    const sample = { OPENAPPS_SAMPLE_DATA: '1' };
    const first = await runMigrations(db.appPool(), dir);
    expect(first.applied).toEqual([
      '0001_crm.sql',
      '0002_english_values.sql',
      '0003_deal_close.sql',
      '0004_next_steps.sql',
      '0005_events.sql',
      '0006_refs.sql',
    ]);
    expect((await runSeeds(db.appPool(), seeds, sample))?.applied).toEqual([
      'seed/0001_beispieldaten.sql',
      'seed/0002_next_steps.sql',
    ]);
    const second = await runMigrations(db.appPool(), dir);
    expect(second.applied).toEqual([]);
    expect((await runSeeds(db.appPool(), seeds, sample))?.applied).toEqual([]);
  });

  it('computes the pipeline of the sample data', async () => {
    const summary = (await run('pipeline.summary', {})) as {
      totals: { count: number; weightedOpenCents: number; wonCents: number };
    };
    expect(summary.totals).toMatchObject({
      count: 5,
      weightedOpenCents: 3275000,
      wonCents: 2150000,
    });
  });

  it('searches case-insensitively and takes % literally', async () => {
    const found = (await run('companies.list', { q: 'crane' })) as {
      companies: { name: string }[];
    };
    expect(found.companies.map((c) => c.name)).toEqual(['Crane Bakery']);
    const none = (await run('companies.list', { q: '%' })) as { companies: unknown[] };
    expect(none.companies).toEqual([]);
    const contacts = (await run('contacts.list', { companyId: STADTWERKE })) as {
      contacts: unknown[];
    };
    expect(contacts.contacts).toHaveLength(2);
  });

  it('keeps the email unique, case-insensitively', async () => {
    const error = await run('contacts.create', {
      name: 'Duplicate',
      email: 'SARAH.KEMP@example.com',
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolInputError);
    expect((error as ToolInputError).issues).toEqual([
      expect.objectContaining({ path: ['email'] }),
    ]);
  });

  it('reports an unknown company as an input error on the field', async () => {
    const error = await run('contacts.create', {
      name: 'Nobody',
      companyId: '0a000000-0000-4000-8000-0000000000ff',
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolInputError);
    expect((error as ToolInputError).issues).toEqual([
      expect.objectContaining({ path: ['companyId'] }),
    ]);
  });

  it('creates a contact, updates it and clears a field', async () => {
    const created = (await run('contacts.create', {
      name: 'New Person',
      email: 'new.person@example.com',
      companyId: HOLZBAU,
    })) as { contact: { id: string; companyName: string } };
    expect(created.contact.companyName).toBe('Linden Timberworks');
    const updated = (await run('contacts.update', {
      id: created.contact.id,
      email: null,
      role: 'Procurement',
    })) as {
      contact: { email: string | null; role: string; updatedAt: string; createdAt: string };
    };
    expect(updated.contact.email).toBeNull();
    expect(updated.contact.role).toBe('Procurement');
    expect(Date.parse(updated.contact.updatedAt)).toBeGreaterThanOrEqual(
      Date.parse(updated.contact.createdAt),
    );
  });

  it('rejects a deal with a contact from a different company', async () => {
    const error = await run('deals.create', {
      title: 'Wrong company',
      companyId: HOLZBAU,
      contactId: KOEHLER,
      valueCents: 100,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolInputError);
  });

  it('creates a deal with the caller as owner', async () => {
    const created = (await run('deals.create', {
      title: 'Workshop planning',
      companyId: HOLZBAU,
      contactId: LINDNER,
      valueCents: 1999,
      expectedClose: '2030-06-30',
    })) as { deal: { owner: string; stage: string; expectedClose: string; valueCents: number } };
    expect(created.deal).toMatchObject({
      owner: 'agent:test',
      stage: 'lead',
      expectedClose: '2030-06-30',
      valueCents: 1999,
    });
  });

  it('writes exactly one activity on a stage change and none for the same stage', async () => {
    const before = (await run('activities.list', { dealId: PORTAL })) as { activities: unknown[] };
    const changed = (await run('deals.update_stage', {
      id: PORTAL,
      stage: 'won',
      note: 'Contract awarded',
    })) as {
      changed: boolean;
      deal: { stage: string; closedAt: string | null; closeReason: string | null };
      activity: { subject: string; body: string; createdBy: string; companyId: string };
    };
    expect(changed.changed).toBe(true);
    expect(changed.deal.stage).toBe('won');
    expect(changed.deal.closeReason).toBe('Contract awarded');
    expect(changed.deal.closedAt).not.toBeNull();
    expect(changed.activity).toMatchObject({
      subject: 'Stage: Proposal → Won',
      body: 'Contract awarded',
      createdBy: 'agent:test',
      companyId: STADTWERKE,
    });

    const same = (await run('deals.update_stage', { id: PORTAL, stage: 'won', note: 'Again' })) as {
      changed: boolean;
      activity: unknown;
    };
    expect(same).toMatchObject({ changed: false, activity: null });

    const after = (await run('activities.list', { dealId: PORTAL })) as { activities: unknown[] };
    expect(after.activities.length).toBe(before.activities.length + 1);
  });

  it('reports an unknown deal on a stage change as not found', async () => {
    const error = await run('deals.update_stage', {
      id: '0d000000-0000-4000-8000-0000000000ff',
      stage: 'proposal',
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolNotFoundError);
  });

  it('takes the company from the deal and shows the activity on the company', async () => {
    const logged = (await run('activities.log', {
      kind: 'call',
      subject: 'Followed up',
      dealId: PORTAL,
    })) as { activity: { id: string; companyId: string } };
    expect(logged.activity.companyId).toBe(STADTWERKE);

    const detail = (await run('companies.get', { id: STADTWERKE })) as {
      contacts: unknown[];
      deals: unknown[];
      activities: { id: string }[];
    };
    expect(detail.contacts).toHaveLength(2);
    expect(detail.deals).toHaveLength(2);
    expect(detail.activities[0]?.id).toBe(logged.activity.id);
  });

  it('reports an unknown company in companies.get as not found', async () => {
    const error = await run('companies.get', { id: '0a000000-0000-4000-8000-0000000000ff' }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ToolNotFoundError);
  });

  it('lets the database reject an activity without a reference', async () => {
    await expect(
      db.query("insert into activities (kind, subject, created_by) values ('note', 'x', 'y')"),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('lets the database reject the old German stage and activity kind values', async () => {
    await expect(
      db.query(
        "insert into deals (title, company_id, stage) values ('x', '0a000000-0000-4000-8000-000000000001', 'gewonnen')",
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      db.query(
        "insert into activities (kind, subject, created_by, deal_id) values ('notiz', 'x', 'y', '0d000000-0000-4000-8000-000000000001')",
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('has the column industry instead of branche', async () => {
    const rows = await db.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'companies' and column_name in ('industry', 'branche')",
    );
    expect(rows.map((row) => row.column_name)).toEqual(['industry']);
  });

  it('gives sample deals that were closed before 0003 a close time', async () => {
    const closed = (await run('deals.list', { status: 'closed' })) as {
      deals: { stage: string; closedAt: string | null }[];
    };
    expect(closed.deals.length).toBeGreaterThan(0);
    for (const deal of closed.deals) {
      expect(['won', 'lost']).toContain(deal.stage);
      expect(deal.closedAt).not.toBeNull();
    }
  });

  it('rejects closing without a reason before touching the database', async () => {
    const error = await run('deals.update_stage', { id: MAINTENANCE, stage: 'lost' }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ToolInputError);
    const detail = (await run('deals.get', { id: MAINTENANCE })) as { deal: { stage: string } };
    expect(detail.deal.stage).toBe('qualified');
  });

  it('clears close time and reason when a deal is reopened', async () => {
    await run('deals.update_stage', { id: MAINTENANCE, stage: 'lost', note: 'No budget' });
    const reopened = (await run('deals.update_stage', { id: MAINTENANCE, stage: 'proposal' })) as {
      deal: { closedAt: string | null; closeReason: string | null };
      activity: { subject: string };
    };
    expect(reopened.deal).toMatchObject({ closedAt: null, closeReason: null });
    expect(reopened.activity.subject).toBe('Stage: Lost → Proposal');
  });

  it('keeps close time and stage consistent in the database, whatever writes', async () => {
    // Der Trigger setzt closed_at selbst und raeumt den Grund beim Oeffnen weg.
    const rows = await db.query<{ closed_at: Date | null; close_reason: string | null }>(
      "insert into deals (title, company_id, stage, close_reason) values ('x', $1, 'won', 'r') returning closed_at, close_reason",
      [STADTWERKE],
    );
    expect(rows[0]?.closed_at).toBeInstanceOf(Date);
    const reopened = await db.query<{ closed_at: Date | null; close_reason: string | null }>(
      "update deals set stage = 'lead' where title = 'x' and company_id = $1 returning closed_at, close_reason",
      [STADTWERKE],
    );
    expect(reopened[0]).toEqual({ closed_at: null, close_reason: null });
    await expect(
      db.query("update deals set close_reason = '' where title = 'x' and company_id = $1", [STADTWERKE]),
    ).resolves.toBeDefined();
    await db.query("delete from deals where title = 'x' and company_id = $1", [STADTWERKE]);
  });

  it('updates a deal but never its stage, and keeps the contact within the company', async () => {
    const updated = (await run('deals.update', {
      id: SCHEDULING,
      valueCents: 1_000_000,
      expectedClose: null,
      owner: 'agent:sales',
    })) as { deal: { valueCents: number; expectedClose: string | null; owner: string; stage: string } };
    expect(updated.deal).toMatchObject({
      valueCents: 1_000_000,
      expectedClose: null,
      owner: 'agent:sales',
      stage: 'lead',
    });
    const error = await run('deals.update', { id: SCHEDULING, contactId: KOEHLER }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ToolInputError);
    const missing = await run('deals.update', {
      id: '0d000000-0000-4000-8000-0000000000ff',
      title: 'x',
    }).catch((e: unknown) => e);
    expect(missing).toBeInstanceOf(ToolNotFoundError);
  });

  it('finds deals by search text and owner', async () => {
    const byText = (await run('deals.list', { q: 'northvale' })) as { deals: { companyId: string }[] };
    expect(byText.deals.length).toBeGreaterThan(0);
    expect(byText.deals.every((deal) => deal.companyId === STADTWERKE)).toBe(true);
    const byOwner = (await run('deals.list', { owner: 'agent:sales' })) as { deals: { id: string }[] };
    expect(byOwner.deals.map((deal) => deal.id)).toContain(SCHEDULING);
  });

  it('lists overdue next steps and shows the earliest open one on the deal', async () => {
    const overdue = (await run('next_steps.list', { status: 'overdue' })) as {
      nextSteps: { id: string; overdue: boolean }[];
    };
    expect(overdue.nextSteps.map((step) => step.id)).toContain(STEP_PORTAL);
    expect(overdue.nextSteps.every((step) => step.overdue)).toBe(true);

    const deal = (await run('deals.get', { id: PORTAL })) as {
      deal: { nextStep: { id: string; overdue: boolean } | null };
    };
    expect(deal.deal.nextStep).toMatchObject({ id: STEP_PORTAL, overdue: true });
  });

  it('completes a next step once, with one activity, and reopens it', async () => {
    const before = (await run('activities.list', { dealId: PORTAL })) as { activities: unknown[] };
    const done = (await run('next_steps.complete', { id: STEP_PORTAL, note: 'Reached her' })) as {
      changed: boolean;
      nextStep: { doneBy: string; doneAt: string | null; overdue: boolean };
      activity: { subject: string; body: string; dealId: string };
    };
    expect(done.changed).toBe(true);
    expect(done.nextStep).toMatchObject({ doneBy: 'agent:test', overdue: false });
    expect(done.activity).toMatchObject({
      subject: 'Done: Follow up on the proposal',
      body: 'Reached her',
      dealId: PORTAL,
    });

    const again = (await run('next_steps.complete', { id: STEP_PORTAL })) as {
      changed: boolean;
      activity: unknown;
    };
    expect(again).toMatchObject({ changed: false, activity: null });

    const after = (await run('activities.list', { dealId: PORTAL })) as { activities: unknown[] };
    expect(after.activities.length).toBe(before.activities.length + 1);

    const reopened = (await run('next_steps.reopen', { id: STEP_PORTAL })) as {
      changed: boolean;
      nextStep: { doneAt: string | null; doneBy: string | null };
      activity: { subject: string };
    };
    expect(reopened.changed).toBe(true);
    expect(reopened.nextStep).toMatchObject({ doneAt: null, doneBy: null });
    expect(reopened.activity.subject).toBe('Reopened: Follow up on the proposal');
  });

  it('creates a next step, takes the company from the deal, and reports unknown ids', async () => {
    const created = (await run('next_steps.create', {
      title: 'Send contract draft',
      dueOn: '2030-01-15',
      dealId: SCHEDULING,
    })) as { nextStep: { companyId: string; owner: string; overdue: boolean } };
    expect(created.nextStep).toMatchObject({ companyId: HOLZBAU, owner: 'agent:test', overdue: false });

    const company = (await run('companies.get', { id: HOLZBAU })) as {
      nextSteps: { title: string }[];
    };
    expect(company.nextSteps.map((step) => step.title)).toContain('Send contract draft');

    const unknownDeal = await run('next_steps.create', {
      title: 'x',
      dueOn: '2030-01-15',
      dealId: '0d000000-0000-4000-8000-0000000000ff',
    }).catch((e: unknown) => e);
    expect(unknownDeal).toBeInstanceOf(ToolNotFoundError);
    const unknownStep = await run('next_steps.complete', {
      id: '0e000000-0000-4000-8000-0000000000ff',
    }).catch((e: unknown) => e);
    expect(unknownStep).toBeInstanceOf(ToolNotFoundError);
  });

  it('queues deal.won, next_step.assigned and next_step.due once, with the change (ADR 0022)', async () => {
    const { crmEvents, emitDueNextSteps } = await import('./events');
    await crmEvents.settle();
    delete process.env.OPENAPPS_PLATFORM_URL;
    await db.query('delete from event_outbox');
    const types = async () =>
      (await db.query<{ type: string; audience: string }>(
        `select payload->>'type' as type, payload->'audience'->>0 as audience from event_outbox order by version`,
      )).map((row) => `${row.type} ${row.audience ?? '-'}`);

    await run('deals.update_stage', { id: MAINTENANCE, stage: 'lost', note: 'Budget cut' });
    await run('next_steps.create', { title: 'Call back', dueOn: '2000-01-01', dealId: MAINTENANCE, owner: 'u_sam' });
    // Der Schritt ist schon faellig: einmal melden, beim zweiten Lauf nicht noch einmal.
    expect(await emitDueNextSteps()).toBeGreaterThanOrEqual(1);
    expect(await emitDueNextSteps()).toBe(0);
    await crmEvents.settle();
    const queued = await types();
    expect(queued.filter((t) => t.startsWith('deal.lost'))).toHaveLength(1);
    expect(queued).toContain('next_step.assigned user:u_sam');
    expect(queued).toContain('next_step.due user:u_sam');
    // Geliefert wurde nichts: keine Plattform. Gespeichert ist trotzdem alles.
    expect((await crmEvents.status()).pending).toBe(queued.length);
  });

  it('queues the references of a note and resolves deals for other apps (ADR 0023)', async () => {
    const { crmRefs } = await import('./refs');
    await crmRefs.settle();
    delete process.env.OPENAPPS_PLATFORM_URL;
    await db.query('delete from refs_outbox');
    await run('activities.log', { kind: 'note', subject: 'Plain note', dealId: PORTAL });
    expect(await db.query('select key from refs_outbox')).toEqual([]);
    const logged = (await run('activities.log', {
      kind: 'note',
      subject: 'Kickoff',
      body: 'Ask @{human:kim@example.com}, see @{wiki:page:p1}',
      dealId: PORTAL,
    })) as { activity: { id: string } };
    await crmRefs.settle();
    const rows = await db.query<{ key: string; targets: string[]; path: string }>(
      `select key, array(select t->>'ref' from jsonb_array_elements(payload->'targets') t) as targets,
              payload->>'path' as path
         from refs_outbox`,
    );
    expect(rows).toEqual([
      {
        key: `crm:activity:${logged.activity.id}`,
        targets: ['human:kim@example.com', 'wiki:page:p1'],
        path: `/deals/${PORTAL}`,
      },
    ]);
    const resolved = (await run('crm.resolve', { type: 'deal', ids: [PORTAL, '0d000000-0000-4000-8000-0000000000ff'] })) as {
      objects: { id: string; path: string }[];
    };
    expect(resolved.objects.map((o) => o.path)).toEqual([`/deals/${PORTAL}`]);
  });

  it('searches companies, contacts and deals for the platform search (ADR 0021)', async () => {
    const found = (await run('search', { query: 'crane', limit: 10 })) as {
      hits: { kind: string; title: string; url: string }[];
    };
    expect(found.hits.some((hit) => hit.kind === 'company' && hit.title === 'Crane Bakery')).toBe(true);
    for (const hit of found.hits) expect(hit.url).toMatch(/^\/(companies|contacts|deals)\/[0-9a-f-]{36}$/);
    const none = (await run('search', { query: '%' })) as { hits: unknown[] };
    expect(none.hits).toEqual([]);
    const limited = (await run('search', { query: 'e', limit: 2 })) as { hits: unknown[] };
    expect(limited.hits.length).toBeLessThanOrEqual(2);
  });

  it('lets the database reject a next step without a reference or a half-done one', async () => {
    await expect(
      db.query("insert into next_steps (title, due_on, created_by) values ('x', current_date, 'y')"),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      db.query('update next_steps set done_at = now() where id = $1', [STEP_PORTAL]),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
