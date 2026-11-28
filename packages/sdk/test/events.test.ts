import { describe, expect, it } from 'vitest';
import {
  actorOf,
  createEventOutbox,
  EventInputError,
  parsePlatformEvent,
  recipientOf,
  subscribe,
  type OutboxQuery,
  type PlatformEvent,
  type ReceivedEvent,
} from '../src/index.js';

/**
 * Ereignisse aus Sicht der App (ADR 0022). Riskant: ein Empfaenger in einer
 * Form, die die Plattform anders liest als die App; ein Ereignis mit Inhalt
 * oder fremdem Link; ein Abonnement, das ein Ereignis quittiert, das der
 * Handler nicht verarbeitet hat.
 */

const NOW = new Date('2026-11-27T10:00:00.000Z');

const valid = {
  id: 'task.assigned:t1:3',
  type: 'task.assigned',
  object: 'task:t1',
  title: 'Assigned to you: Write the offer',
  path: '/task/t1',
  actor: 'human:Anna@Example.com',
  audience: ['human:Ben@Example.com', 'human:ben@example.com', null, 'group:sales'],
  occurredAt: '2026-11-27T09:59:00.000Z',
};

describe('parsePlatformEvent', () => {
  it('bringt ein gueltiges Ereignis in feste Form: E-Mail klein, Doppel und null weg', () => {
    expect(parsePlatformEvent(valid, NOW)).toEqual({
      id: 'task.assigned:t1:3',
      type: 'task.assigned',
      object: 'task:t1',
      title: 'Assigned to you: Write the offer',
      path: '/task/t1',
      actor: 'human:anna@example.com',
      audience: ['human:ben@example.com', 'group:sales'],
      occurredAt: '2026-11-27T09:59:00.000Z',
    });
  });

  it('weist Felder ausserhalb der Form ab, etwa Inhalt', () => {
    expect(() => parsePlatformEvent({ ...valid, body: 'the whole offer' }, NOW)).toThrow(
      EventInputError,
    );
  });

  it('weist einen Link aus der App heraus ab', () => {
    for (const path of ['https://evil.invalid/x', '//evil.invalid', '/a/../../admin', 'task/1']) {
      expect(() => parsePlatformEvent({ ...valid, path }, NOW), path).toThrow(EventInputError);
    }
  });

  it('weist Empfaenger ausserhalb der vier Formen ab, auch Apps', () => {
    for (const entry of ['app:crm', 'everyone', 'human:not-an-email', 'group:Sales', 'user:']) {
      expect(() => parsePlatformEvent({ ...valid, audience: [entry] }, NOW), entry).toThrow(
        EventInputError,
      );
    }
  });

  it('begrenzt die Empfaenger auf 50', () => {
    const audience = Array.from({ length: 51 }, (_, i) => `human:p${String(i)}@example.com`);
    expect(() => parsePlatformEvent({ ...valid, audience }, NOW)).toThrow(/more than 50/);
  });

  it('weist falsche Typen, Ids und Zeiten in der Zukunft ab', () => {
    expect(() => parsePlatformEvent({ ...valid, type: 'assigned' }, NOW)).toThrow();
    expect(() => parsePlatformEvent({ ...valid, id: 'with space' }, NOW)).toThrow();
    expect(() =>
      parsePlatformEvent({ ...valid, occurredAt: '2026-11-27T11:00:00.000Z' }, NOW),
    ).toThrow(/future/);
    expect(() => parsePlatformEvent({ ...valid, occurredAt: 'yesterday' }, NOW)).toThrow();
  });

  it('macht den Titel einzeilig, kuerzt ihn und weist einen leeren ab', () => {
    const parsed = parsePlatformEvent({ ...valid, title: `Line\none ${'x'.repeat(300)}` }, NOW);
    expect(parsed.title.startsWith('Line one')).toBe(true);
    expect(parsed.title.length).toBe(200);
    expect(() => parsePlatformEvent({ ...valid, title: ' \n ' }, NOW)).toThrow(/empty/);
  });
});

describe('recipientOf und actorOf', () => {
  it('liest, was Apps ueber Personen speichern', () => {
    expect(recipientOf('Anna@Example.com')).toBe('human:anna@example.com');
    expect(recipientOf('agent:operator')).toBe('agent:operator');
    expect(recipientOf('operator@agents.invalid')).toBe('agent:operator');
    expect(recipientOf('u_8f2Kq1')).toBe('user:u_8f2Kq1');
  });

  it('gibt Apps und Unbrauchbares keinen Eingang', () => {
    expect(recipientOf('app:wiki')).toBeNull();
    expect(recipientOf('wiki@apps.invalid')).toBeNull();
    expect(recipientOf('')).toBeNull();
    expect(recipientOf(null)).toBeNull();
    expect(recipientOf('two words')).toBeNull();
  });

  it('laesst eine App als Ausloeser stehen', () => {
    expect(actorOf('app:wiki')).toBe('app:wiki');
    expect(actorOf('wiki@apps.invalid')).toBe('app:wiki');
    expect(actorOf('anna@example.com')).toBe('human:anna@example.com');
  });
});

describe('createEventOutbox', () => {
  it('prueft vor dem Schreiben und schreibt mit „dieselbe Id ist dasselbe Ereignis"', async () => {
    const statements: { sql: string; params: readonly unknown[] }[] = [];
    const q: OutboxQuery = async (sql, params = []) => {
      statements.push({ sql, params });
      return [];
    };
    const events = createEventOutbox({ query: q });

    await expect(events.emit(q, { ...valid, path: 'https://evil.invalid' })).rejects.toThrow(
      EventInputError,
    );
    expect(statements).toEqual([]);

    await events.emit(q, valid);
    expect(statements).toHaveLength(1);
    expect(statements[0]?.sql).toContain('insert into event_outbox (key, payload)');
    expect(statements[0]?.sql).toContain('do nothing');
    expect(statements[0]?.params[0]).toEqual(['task.assigned:t1:3']);
    const payload = JSON.parse((statements[0]?.params[1] as string[])[0] ?? '{}') as PlatformEvent;
    expect(payload.audience).toEqual(['human:ben@example.com', 'group:sales']);
  });

  it('liefert ueber den angegebenen Weg und meldet Doppel als Erfolg', async () => {
    const rows: { key: string; version: string; payload: unknown; attempts: number }[] = [];
    const q: OutboxQuery = async <R extends Record<string, unknown>>(
      sql: string,
      params: readonly unknown[] = [],
    ): Promise<R[]> => {
      if (sql.includes('insert into')) {
        const payloads = params[1] as string[];
        (params[0] as string[]).forEach((key, i) =>
          rows.push({ key, version: '1', payload: JSON.parse(payloads[i] ?? 'null'), attempts: 0 }),
        );
        return [];
      }
      if (sql.includes('count(*)')) return [{ n: rows.length } as unknown as R];
      if (sql.includes('delete')) {
        rows.splice(
          rows.findIndex((row) => row.key === params[0]),
          1,
        );
        return [];
      }
      if (sql.trim().startsWith('select')) return rows as unknown as R[];
      return [];
    };
    const sent: PlatformEvent[] = [];
    const events = createEventOutbox({
      query: q,
      send: async (event) => {
        sent.push(event);
        return { status: 'duplicate' };
      },
    });
    await events.emit(q, { ...valid, occurredAt: new Date().toISOString() });
    const report = await events.deliverPending();
    expect(report).toMatchObject({ delivered: 1, pending: 0 });
    expect(sent[0]?.type).toBe('task.assigned');
  });
});

describe('subscribe', () => {
  const event = (seq: number, type = 'message.received'): ReceivedEvent => ({
    seq,
    id: `m${String(seq)}`,
    app: 'mail',
    type,
    object: `message:${String(seq)}`,
    title: `Mail ${String(seq)}`,
    path: `/m/${String(seq)}`,
    actor: null,
    occurredAt: NOW.toISOString(),
  });

  function feed(batches: ReceivedEvent[][]) {
    const acks: number[] = [];
    let cursor = 0;
    return {
      acks,
      poll: async () => {
        const all = batches.flat().filter((e) => e.seq > cursor);
        return { events: all.slice(0, 2) };
      },
      ack: async (upTo: number) => {
        acks.push(upTo);
        cursor = Math.max(cursor, upTo);
      },
    };
  }

  it('gibt nur die gewuenschten Typen an den Handler und quittiert bis zum letzten', async () => {
    const source = feed([[event(1), event(2, 'message.deleted'), event(3)]]);
    const seen: string[] = [];
    const sub = subscribe(
      ['mail.message.received'],
      async (e) => {
        seen.push(e.id);
      },
      { poll: source.poll, ack: source.ack, limit: 2, logger: { info() {}, warn() {} } },
    );
    const report = await sub.pollOnce();
    expect(seen).toEqual(['m1', 'm3']);
    expect(report).toMatchObject({ handled: 2, skipped: 1, stopped: false });
    expect(source.acks).toEqual([2, 3]);
  });

  it('quittiert nichts nach einem gescheiterten Handler: das Ereignis kommt wieder', async () => {
    const source = feed([[event(1), event(2)]]);
    let fail = true;
    const seen: string[] = [];
    const sub = subscribe(
      ['mail.message.received'],
      async (e) => {
        if (e.seq === 2 && fail) throw new Error('db down');
        seen.push(e.id);
      },
      { poll: source.poll, ack: source.ack, limit: 2, logger: { info() {}, warn() {} } },
    );
    const first = await sub.pollOnce();
    expect(first.stopped).toBe(true);
    expect(source.acks).toEqual([1]);

    fail = false;
    await sub.pollOnce();
    expect(seen).toEqual(['m1', 'm2']);
    expect(source.acks).toEqual([1, 2]);
  });

  it('haelt an, wenn die Plattform nicht liefert, ohne etwas zu quittieren', async () => {
    const acks: number[] = [];
    const sub = subscribe(['mail.message.received'], async () => undefined, {
      poll: async () => {
        throw new Error('permission_denied');
      },
      ack: async (upTo) => {
        acks.push(upTo);
      },
      logger: { info() {}, warn() {} },
    });
    expect((await sub.pollOnce()).stopped).toBe(true);
    expect(acks).toEqual([]);
  });
});
