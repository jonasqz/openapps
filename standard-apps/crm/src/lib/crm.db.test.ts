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
    expect(first.applied).toEqual(['0001_crm.sql', '0002_english_values.sql']);
    expect((await runSeeds(db.appPool(), seeds, sample))?.applied).toEqual([
      'seed/0001_beispieldaten.sql',
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
      deal: { stage: string };
      activity: { subject: string; body: string; createdBy: string; companyId: string };
    };
    expect(changed.changed).toBe(true);
    expect(changed.deal.stage).toBe('won');
    expect(changed.activity).toMatchObject({
      subject: 'Stage: Proposal → Won',
      body: 'Contract awarded',
      createdBy: 'agent:test',
      companyId: STADTWERKE,
    });

    const same = (await run('deals.update_stage', { id: PORTAL, stage: 'won' })) as {
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
});
