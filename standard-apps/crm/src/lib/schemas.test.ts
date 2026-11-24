import { describe, expect, it } from 'vitest';
import {
  ActivitiesListArgs,
  ActivityLogArgs,
  CompaniesListArgs,
  CompanyCreateArgs,
  ContactCreateArgs,
  ContactUpdateArgs,
  DealCreateArgs,
  DealsListArgs,
  DealUpdateStageArgs,
  IdArgs,
  PipelineSummaryArgs,
} from './schemas';

/**
 * Die Schemas sind die Grenze, an der Agents mit falschen Argumenten
 * scheitern sollen — mit einer Meldung, aus der sie lernen. Getestet werden
 * die Raender, nicht der glatte Fall.
 */

const COMPANY = '0a000000-0000-4000-8000-000000000001';
const CONTACT = '0b000000-0000-4000-8000-000000000001';
const DEAL = '0d000000-0000-4000-8000-000000000001';

function messages(result: { success: boolean; error?: { issues: { message: string }[] } }): string {
  return result.error?.issues.map((issue) => issue.message).join(' | ') ?? '';
}

describe('strikte Argumente', () => {
  it('weist unbekannte Schluessel ab, etwa snake_case statt camelCase', () => {
    expect(ContactCreateArgs.safeParse({ name: 'Ada', company_id: COMPANY }).success).toBe(false);
    expect(DealsListArgs.safeParse({ stage: 'lead', status: 'offen' }).success).toBe(false);
    expect(PipelineSummaryArgs.safeParse({ stage: 'lead' }).success).toBe(false);
  });

  it('nimmt fehlende optionale Argumente als leer', () => {
    expect(CompaniesListArgs.parse({})).toEqual({ limit: 50 });
    expect(ActivitiesListArgs.parse({})).toEqual({ limit: 50 });
    expect(PipelineSummaryArgs.parse({})).toEqual({});
  });

  it('weist Nicht-Objekte ab', () => {
    for (const value of [null, 'lead', 42, []]) {
      expect(CompaniesListArgs.safeParse(value).success).toBe(false);
    }
  });
});

describe('limit', () => {
  it('erlaubt 1 bis 200 als ganze Zahl', () => {
    expect(CompaniesListArgs.parse({ limit: 1 }).limit).toBe(1);
    expect(CompaniesListArgs.parse({ limit: 200 }).limit).toBe(200);
    for (const limit of [0, 201, 1.5, -1, '10', null]) {
      expect(CompaniesListArgs.safeParse({ limit }).success, String(limit)).toBe(false);
    }
  });
});

describe('Ids', () => {
  it('verlangt eine UUID', () => {
    expect(IdArgs.parse({ id: ` ${COMPANY} ` }).id).toBe(COMPANY);
    for (const id of ['', '1', 'abc', `${COMPANY}x`, 42, null]) {
      expect(IdArgs.safeParse({ id }).success, String(id)).toBe(false);
    }
    expect(messages(IdArgs.safeParse({ id: 'x' }))).toContain('UUID');
  });
});

describe('companies.create', () => {
  it('trimmt den Namen und verlangt ihn', () => {
    expect(CompanyCreateArgs.parse({ name: '  Holzbau Lindner  ' }).name).toBe('Holzbau Lindner');
    for (const name of ['', '   ', undefined]) {
      expect(CompanyCreateArgs.safeParse({ name }).success).toBe(false);
    }
  });

  it('haelt 200 Zeichen als Grenze', () => {
    expect(CompanyCreateArgs.safeParse({ name: 'x'.repeat(200) }).success).toBe(true);
    expect(CompanyCreateArgs.safeParse({ name: 'x'.repeat(201) }).success).toBe(false);
  });

  it('ergaenzt https:// und nimmt nur http(s)', () => {
    expect(CompanyCreateArgs.parse({ name: 'A', website: 'example.com' }).website).toBe(
      'https://example.com',
    );
    expect(CompanyCreateArgs.parse({ name: 'A', website: 'http://example.com/x' }).website).toBe(
      'http://example.com/x',
    );
    for (const website of ['javascript:alert(1)', 'ftp://example.com', 'data:text/html,x', 'localhost']) {
      expect(CompanyCreateArgs.safeParse({ name: 'A', website }).success, website).toBe(false);
    }
  });

  it('nimmt leeren Text bei optionalen Feldern als nicht angegeben', () => {
    expect(CompanyCreateArgs.parse({ name: 'A', website: '', branche: ' ', notes: '' })).toEqual({
      name: 'A',
    });
  });
});

describe('contacts.create und contacts.update', () => {
  it('prueft die E-Mail', () => {
    expect(ContactCreateArgs.parse({ name: 'A', email: ' Ada@Example.com ' }).email).toBe(
      'Ada@Example.com',
    );
    for (const email of ['ada', 'ada@', '@example.com', 'a b@example.com', `${'a'.repeat(250)}@example.com`]) {
      expect(ContactCreateArgs.safeParse({ name: 'A', email }).success, email).toBe(false);
    }
  });

  it('prueft die Telefonnummer', () => {
    for (const phone of ['+49 30 1234-56', '030/123456', '(030) 123.456']) {
      expect(ContactCreateArgs.safeParse({ name: 'A', phone }).success, phone).toBe(true);
    }
    for (const phone of ['eins zwei', '+49<script>', '1'.repeat(51)]) {
      expect(ContactCreateArgs.safeParse({ name: 'A', phone }).success, phone).toBe(false);
    }
  });

  it('verlangt beim Update mindestens ein Feld ausser id', () => {
    const result = ContactUpdateArgs.safeParse({ id: CONTACT });
    expect(result.success).toBe(false);
    expect(messages(result)).toContain('mindestens eines');
  });

  it('unterscheidet beim Update "nicht nennen" und "loeschen"', () => {
    expect(ContactUpdateArgs.parse({ id: CONTACT, role: 'CFO' })).toEqual({ id: CONTACT, role: 'CFO' });
    expect(ContactUpdateArgs.parse({ id: CONTACT, email: null })).toEqual({ id: CONTACT, email: null });
    expect(ContactUpdateArgs.parse({ id: CONTACT, companyId: '' })).toEqual({
      id: CONTACT,
      companyId: null,
    });
  });

  it('laesst den Namen beim Update nicht loeschen', () => {
    expect(ContactUpdateArgs.safeParse({ id: CONTACT, name: null }).success).toBe(false);
    // Leerer Name heisst "nicht aendern" — ohne weiteres Feld bleibt nichts zu tun.
    expect(ContactUpdateArgs.safeParse({ id: CONTACT, name: '' }).success).toBe(false);
  });
});

describe('deals', () => {
  const base = { title: 'Portal', companyId: COMPANY, valueCents: 1250000 };

  it('setzt lead als Vorgabe-Stage', () => {
    expect(DealCreateArgs.parse(base).stage).toBe('lead');
    expect(DealCreateArgs.parse({ ...base, stage: '' }).stage).toBe('lead');
  });

  it('verlangt ganze, nicht negative Cent', () => {
    expect(DealCreateArgs.safeParse({ ...base, valueCents: 0 }).success).toBe(true);
    expect(DealCreateArgs.safeParse({ ...base, valueCents: Number.MAX_SAFE_INTEGER }).success).toBe(true);
    for (const valueCents of [-1, 12.5, '1250000', Number.MAX_SAFE_INTEGER + 1, Number.NaN, Infinity, null]) {
      expect(DealCreateArgs.safeParse({ ...base, valueCents }).success, String(valueCents)).toBe(false);
    }
    expect(DealCreateArgs.safeParse({ title: 'X', companyId: COMPANY }).success).toBe(false);
  });

  it('verlangt eine Firma', () => {
    expect(DealCreateArgs.safeParse({ title: 'X', valueCents: 1 }).success).toBe(false);
  });

  it('prueft das Datum auf Format und Kalender', () => {
    expect(DealCreateArgs.parse({ ...base, expectedClose: '2028-02-29' }).expectedClose).toBe('2028-02-29');
    for (const expectedClose of ['2027-02-29', '2025-13-01', '2025-04-31', '01.03.2025', '2025-3-1', '1899-12-31']) {
      expect(DealCreateArgs.safeParse({ ...base, expectedClose }).success, expectedClose).toBe(false);
    }
  });

  it('kennt nur die fuenf Stages', () => {
    for (const stage of ['lead', 'qualifiziert', 'angebot', 'gewonnen', 'verloren']) {
      expect(DealUpdateStageArgs.safeParse({ id: DEAL, stage }).success, stage).toBe(true);
    }
    for (const stage of ['Lead', 'won', 'offen', '', null]) {
      expect(DealUpdateStageArgs.safeParse({ id: DEAL, stage }).success, String(stage)).toBe(false);
    }
    expect(messages(DealUpdateStageArgs.safeParse({ id: DEAL, stage: 'won' }))).toContain('qualifiziert');
  });

  it('begrenzt die Notiz zum Stage-Wechsel', () => {
    expect(DealUpdateStageArgs.safeParse({ id: DEAL, stage: 'angebot', note: 'x'.repeat(2000) }).success).toBe(true);
    expect(DealUpdateStageArgs.safeParse({ id: DEAL, stage: 'angebot', note: 'x'.repeat(2001) }).success).toBe(false);
  });
});

describe('activities.log', () => {
  it('verlangt mindestens einen Bezug', () => {
    const result = ActivityLogArgs.safeParse({ kind: 'notiz', subject: 'Hallo' });
    expect(result.success).toBe(false);
    expect(messages(result)).toContain('contactId, companyId, dealId');
    // Leere Ids zaehlen nicht als Bezug.
    expect(ActivityLogArgs.safeParse({ kind: 'notiz', subject: 'H', companyId: '' }).success).toBe(false);
  });

  it('nimmt jeden der drei Bezuege allein', () => {
    for (const ref of [{ contactId: CONTACT }, { companyId: COMPANY }, { dealId: DEAL }]) {
      expect(ActivityLogArgs.safeParse({ kind: 'anruf', subject: 'H', ...ref }).success).toBe(true);
    }
  });

  it('kennt nur die vier Arten', () => {
    for (const kind of ['notiz', 'anruf', 'mail', 'termin']) {
      expect(ActivityLogArgs.safeParse({ kind, subject: 'H', dealId: DEAL }).success).toBe(true);
    }
    for (const kind of ['email', 'Notiz', '', undefined]) {
      expect(ActivityLogArgs.safeParse({ kind, subject: 'H', dealId: DEAL }).success).toBe(false);
    }
  });

  it('verlangt einen ISO-Zeitpunkt mit Zeitzone', () => {
    const ok = ['2025-03-01T09:30:00Z', '2025-03-01T09:30:00+01:00', '2025-03-01T09:30:00.123Z'];
    for (const happenedAt of ok) {
      expect(ActivityLogArgs.safeParse({ kind: 'mail', subject: 'H', dealId: DEAL, happenedAt }).success, happenedAt).toBe(true);
    }
    for (const happenedAt of ['2025-03-01', '01.03.2025 09:30', 'gestern', '2025-03-01T09:30:00']) {
      expect(ActivityLogArgs.safeParse({ kind: 'mail', subject: 'H', dealId: DEAL, happenedAt }).success, happenedAt).toBe(false);
    }
  });

  it('begrenzt Betreff und Inhalt', () => {
    expect(ActivityLogArgs.safeParse({ kind: 'notiz', subject: 'x'.repeat(201), dealId: DEAL }).success).toBe(false);
    expect(ActivityLogArgs.safeParse({ kind: 'notiz', subject: 'x', body: 'y'.repeat(10001), dealId: DEAL }).success).toBe(false);
    expect(ActivityLogArgs.safeParse({ kind: 'notiz', subject: 'x', body: 'y'.repeat(10000), dealId: DEAL }).success).toBe(true);
  });
});
