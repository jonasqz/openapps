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

describe.skipIf(!enabled)('CRM gegen Postgres', () => {
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

  it('verbindet mit einer Rolle ohne Superuser und ohne BYPASSRLS', async () => {
    const rows = await db.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      'select rolsuper, rolbypassrls from pg_roles where rolname = current_user',
    );
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('spielt Migration und Beispieldaten ein und beim zweiten Lauf nichts', async () => {
    const dir = join(process.cwd(), 'migrations');
    const seeds = join(process.cwd(), 'seeds');
    const sample = { OPENAPPS_SAMPLE_DATA: '1' };
    const first = await runMigrations(db.appPool(), dir);
    expect(first.applied).toEqual(['0001_crm.sql']);
    expect((await runSeeds(db.appPool(), seeds, sample))?.applied).toEqual([
      'seed/0001_beispieldaten.sql',
    ]);
    const second = await runMigrations(db.appPool(), dir);
    expect(second.applied).toEqual([]);
    expect((await runSeeds(db.appPool(), seeds, sample))?.applied).toEqual([]);
  });

  it('rechnet die Pipeline der Beispieldaten', async () => {
    const summary = (await run('pipeline.summary', {})) as {
      totals: { count: number; weightedOpenCents: number; wonCents: number };
    };
    expect(summary.totals).toMatchObject({
      count: 5,
      weightedOpenCents: 3275000,
      wonCents: 2150000,
    });
  });

  it('sucht ohne Gross-/Kleinschreibung und nimmt % woertlich', async () => {
    const found = (await run('companies.list', { q: 'kranz' })) as {
      companies: { name: string }[];
    };
    expect(found.companies.map((c) => c.name)).toEqual(['Bäckerei Kranz']);
    const none = (await run('companies.list', { q: '%' })) as { companies: unknown[] };
    expect(none.companies).toEqual([]);
    const contacts = (await run('contacts.list', { companyId: STADTWERKE })) as {
      contacts: unknown[];
    };
    expect(contacts.contacts).toHaveLength(2);
  });

  it('haelt die E-Mail eindeutig, ohne Gross-/Kleinschreibung', async () => {
    const error = await run('contacts.create', {
      name: 'Doppelt',
      email: 'SABINE.KOEHLER@example.com',
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolInputError);
    expect((error as ToolInputError).issues).toEqual([
      expect.objectContaining({ path: ['email'] }),
    ]);
  });

  it('meldet eine unbekannte Firma als Eingabefehler am Feld', async () => {
    const error = await run('contacts.create', {
      name: 'Niemand',
      companyId: '0a000000-0000-4000-8000-0000000000ff',
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolInputError);
    expect((error as ToolInputError).issues).toEqual([
      expect.objectContaining({ path: ['companyId'] }),
    ]);
  });

  it('legt Kontakt an, aendert und loescht ein Feld', async () => {
    const created = (await run('contacts.create', {
      name: 'Neu Person',
      email: 'neu.person@example.com',
      companyId: HOLZBAU,
    })) as { contact: { id: string; companyName: string } };
    expect(created.contact.companyName).toBe('Holzbau Lindner');
    const updated = (await run('contacts.update', {
      id: created.contact.id,
      email: null,
      role: 'Einkauf',
    })) as {
      contact: { email: string | null; role: string; updatedAt: string; createdAt: string };
    };
    expect(updated.contact.email).toBeNull();
    expect(updated.contact.role).toBe('Einkauf');
    expect(Date.parse(updated.contact.updatedAt)).toBeGreaterThanOrEqual(
      Date.parse(updated.contact.createdAt),
    );
  });

  it('lehnt einen Deal mit Kontakt einer anderen Firma ab', async () => {
    const error = await run('deals.create', {
      title: 'Falsch verbunden',
      companyId: HOLZBAU,
      contactId: KOEHLER,
      valueCents: 100,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolInputError);
  });

  it('legt einen Deal an, Verantwortlicher ist der Aufrufer', async () => {
    const created = (await run('deals.create', {
      title: 'Werkstattplanung',
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

  it('schreibt bei einem Stage-Wechsel genau eine Aktivitaet, bei gleicher Stage keine', async () => {
    const before = (await run('activities.list', { dealId: PORTAL })) as { activities: unknown[] };
    const changed = (await run('deals.update_stage', {
      id: PORTAL,
      stage: 'gewonnen',
      note: 'Zuschlag',
    })) as {
      changed: boolean;
      deal: { stage: string };
      activity: { subject: string; body: string; createdBy: string; companyId: string };
    };
    expect(changed.changed).toBe(true);
    expect(changed.deal.stage).toBe('gewonnen');
    expect(changed.activity).toMatchObject({
      subject: 'Stage: Angebot → Gewonnen',
      body: 'Zuschlag',
      createdBy: 'agent:test',
      companyId: STADTWERKE,
    });

    const same = (await run('deals.update_stage', { id: PORTAL, stage: 'gewonnen' })) as {
      changed: boolean;
      activity: unknown;
    };
    expect(same).toMatchObject({ changed: false, activity: null });

    const after = (await run('activities.list', { dealId: PORTAL })) as { activities: unknown[] };
    expect(after.activities.length).toBe(before.activities.length + 1);
  });

  it('meldet einen unbekannten Deal beim Stage-Wechsel als nicht gefunden', async () => {
    const error = await run('deals.update_stage', {
      id: '0d000000-0000-4000-8000-0000000000ff',
      stage: 'angebot',
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolNotFoundError);
  });

  it('uebernimmt die Firma aus dem Deal und zeigt die Aktivitaet bei der Firma', async () => {
    const logged = (await run('activities.log', {
      kind: 'anruf',
      subject: 'Nachgefasst',
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

  it('meldet eine unbekannte Firma bei companies.get als nicht gefunden', async () => {
    const error = await run('companies.get', { id: '0a000000-0000-4000-8000-0000000000ff' }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ToolNotFoundError);
  });

  it('laesst die Datenbank keine Aktivitaet ohne Bezug zu', async () => {
    await expect(
      db.query("insert into activities (kind, subject, created_by) values ('notiz', 'x', 'y')"),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
