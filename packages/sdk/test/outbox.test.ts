import { describe, expect, it } from 'vitest';
import { AppCallError, createOutbox, describeOutboxError, type OutboxQuery } from '../src/index.js';

/**
 * Die Outbox (ADR 0020 D, ADR 0022 B). Riskant: ein Eintrag, der geloescht
 * wird, obwohl waehrend der Lieferung eine neuere Version kam; ein Fehler,
 * der das Speichern der App aufhaelt; ein Secret im Log; ein Name aus
 * fremder Hand im SQL.
 *
 * Die Tabelle ist hier ein kleiner Speicher, der genau die Anweisungen
 * versteht, die die Outbox schickt. Gegen Postgres laeuft dieselbe Schleife
 * in den Tests des Wikis (`pages.db.test.ts`).
 */

interface Row {
  key: string;
  version: number;
  payload: unknown;
  attempts: number;
  last_error: string | null;
}

function fakeTable() {
  const rows = new Map<string, Row>();
  let version = 0;
  const statements: string[] = [];
  const query: OutboxQuery = async <R extends Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<R[]> => {
    const text = sql.replace(/\s+/g, ' ').trim();
    statements.push(text);
    if (text.startsWith('insert into')) {
      const keys = params[0] as string[];
      const payloads = (params[1] as (string | null)[] | undefined) ?? [];
      keys.forEach((key, index) => {
        const existing = rows.get(key);
        if (existing !== undefined && text.includes('do nothing')) return;
        const raw = payloads[index];
        rows.set(key, {
          key,
          version: ++version,
          payload: raw === undefined || raw === null ? null : (JSON.parse(raw) as unknown),
          attempts: 0,
          last_error: null,
        });
      });
      return [];
    }
    if (text.startsWith('select count(*)::int as n')) return [{ n: rows.size } as unknown as R];
    if (text.startsWith('select count(*)::int as pending')) {
      const failing = [...rows.values()].filter((row) => row.attempts > 0).length;
      return [{ pending: rows.size, failing, oldest: null } as unknown as R];
    }
    if (text.includes('where attempts > 0')) {
      return [...rows.values()]
        .filter((row) => row.attempts > 0)
        .map((row) => ({ ...row, last_attempt_at: null }) as unknown as R);
    }
    if (text.startsWith('select')) {
      const limit = Number(params[0]);
      return [...rows.values()]
        .sort((a, b) => a.attempts - b.attempts || a.version - b.version)
        .slice(0, limit)
        .map(
          (row) =>
            ({
              key: row.key,
              version: String(row.version),
              payload: text.includes('null as payload') ? null : row.payload,
              attempts: row.attempts,
            }) as unknown as R,
        );
    }
    if (text.startsWith('delete from')) {
      const row = rows.get(String(params[0]));
      if (row !== undefined && String(row.version) === String(params[1])) rows.delete(row.key);
      return [];
    }
    if (text.startsWith('update')) {
      const row = rows.get(String(params[0]));
      if (row !== undefined && String(row.version) === String(params[1])) {
        row.attempts += 1;
        row.last_error = String(params[2]);
      }
      return [];
    }
    throw new Error(`unexpected statement: ${text}`);
  };
  return {
    rows,
    query,
    statements,
    requeue(key: string) {
      const row = rows.get(key);
      if (row !== undefined) row.version = ++version;
    },
  };
}

const quiet = { info: () => undefined, warn: () => undefined };

describe('createOutbox', () => {
  it('liefert, was eingereiht ist, und loescht nur die gelieferte Version', async () => {
    const table = fakeTable();
    const delivered: string[] = [];
    const outbox = createOutbox({
      name: '[test]',
      table: 'event_outbox',
      query: table.query,
      logger: quiet,
      async deliver(entry) {
        delivered.push(entry.key);
        // Waehrend der Lieferung kommt eine neue Aenderung an `b`.
        if (entry.key === 'b') table.requeue('b');
      },
    });
    await outbox.enqueue(table.query, [{ key: 'a', payload: { n: 1 } }, { key: 'b' }]);

    const report = await outbox.deliverPending();
    expect(delivered).toEqual(['a', 'b']);
    expect(report).toMatchObject({ delivered: 2, failed: 0, pending: 1, stopped: false });
    // `b` bleibt mit der neuen Version stehen und geht beim naechsten Mal raus.
    expect([...table.rows.keys()]).toEqual(['b']);
  });

  it('bricht ab, wenn die Plattform gerade nicht annimmt, und behaelt den Eintrag mit Fehler', async () => {
    const table = fakeTable();
    const outbox = createOutbox({
      name: '[test]',
      table: 'event_outbox',
      query: table.query,
      logger: quiet,
      async deliver() {
        throw new AppCallError('denied', 'platform.emit_event: not granted', 403);
      },
    });
    await outbox.enqueue(table.query, [{ key: 'a' }, { key: 'b' }]);
    const report = await outbox.deliverPending();
    expect(report).toMatchObject({ delivered: 0, failed: 1, pending: 2, stopped: true });
    expect(report.lastError).toBe('denied: platform.emit_event: not granted');
    expect(table.rows.get('a')?.attempts).toBe(1);
    expect(table.rows.get('b')?.attempts).toBe(0);
  });

  it('macht nach einem abgelehnten Eintrag mit dem naechsten weiter', async () => {
    const table = fakeTable();
    const outbox = createOutbox({
      name: '[test]',
      table: 'event_outbox',
      query: table.query,
      logger: quiet,
      async deliver(entry) {
        if (entry.key === 'a') throw new AppCallError('invalid', 'type not declared', 400);
      },
    });
    await outbox.enqueue(table.query, [{ key: 'a' }, { key: 'b' }]);
    const report = await outbox.deliverPending();
    expect(report).toMatchObject({ delivered: 1, failed: 1, pending: 1, stopped: false });
    // Der abgelehnte Eintrag rueckt nach hinten (weniger Versuche zuerst).
    const status = await outbox.status();
    expect(status.errors).toEqual([
      { key: 'a', attempts: 1, lastError: 'invalid: type not declared', lastAttemptAt: null },
    ]);
  });

  it('ignore laesst einen wartenden Eintrag, requeue setzt ihn zurueck', async () => {
    const table = fakeTable();
    const outbox = createOutbox({
      name: '[test]',
      table: 'event_outbox',
      query: table.query,
      logger: quiet,
      deliver: async () => undefined,
    });
    await outbox.enqueue(table.query, [{ key: 'a', payload: { v: 1 } }]);
    await outbox.enqueue(table.query, [{ key: 'a', payload: { v: 2 } }], { onConflict: 'ignore' });
    expect(table.rows.get('a')?.payload).toEqual({ v: 1 });
    expect(table.statements.at(-1)).toContain('on conflict (key) do nothing');
    await outbox.enqueue(table.query, [{ key: 'a', payload: { v: 3 } }]);
    expect(table.statements.at(-1)).toContain("set version = nextval('event_outbox_version_seq')");
  });

  it('kick wartet nicht und wirft nie, auch wenn die Datenbank weg ist', async () => {
    const warnings: string[] = [];
    const outbox = createOutbox({
      name: '[test]',
      table: 'event_outbox',
      logger: { info: () => undefined, warn: (line) => warnings.push(line) },
      query: async () => {
        throw new Error('connect ECONNREFUSED postgres://user:geheim@db');
      },
      deliver: async () => undefined,
    });
    expect(() => outbox.kick()).not.toThrow();
    await outbox.settle();
    // Nur der Name des Fehlers, nie seine Meldung mit der Adresse.
    expect(warnings).toEqual(['[test]: Error: delivery failed']);
    expect(warnings.join('')).not.toContain('geheim');
  });

  it('nimmt nur schlichte Postgres-Namen fuer Tabelle und Spalten', () => {
    const base = { name: '[t]', query: fakeTable().query, deliver: async () => undefined };
    expect(() => createOutbox({ ...base, table: 'outbox; drop table pages' })).toThrow();
    expect(() => createOutbox({ ...base, table: 'outbox', keyColumn: 'Key' })).toThrow();
    expect(() => createOutbox({ ...base, table: 'outbox', versionSequence: "x')--" })).toThrow();
  });

  it('beschreibt Fehler ohne Meldungen fremder Fehler', () => {
    expect(describeOutboxError(new AppCallError('timeout', 'x: no answer', 504))).toBe(
      'timeout: x: no answer',
    );
    expect(describeOutboxError(new TypeError('secret=abc'))).toBe('TypeError: delivery failed');
    expect(describeOutboxError('weird')).toBe('delivery failed');
  });
});
