import { describe, expect, it } from 'vitest';
import {
  createRefsOutbox,
  extractRefs,
  normalizeResolveResult,
  ownRef,
  parseResolveArgs,
  parseSetRefs,
  refTargetsFromText,
  RefsInputError,
  ToolInputError,
  type OutboxQuery,
  type SetRefsPayload,
} from '../src/index.js';

/**
 * Verweise aus Sicht der App (ADR 0023). Riskant: eine Quelle, die nicht der
 * App gehoert (das prueft die Plattform, hier nur die Form), ein Ziel in
 * einer Form, die die Plattform anders liest, ein Titel, der als Inhalt
 * durchrutscht, und ein Resolver, der fremde Ids oder Links liefert.
 */

const NOW = new Date('2026-11-28T10:00:00.000Z');

describe('parseSetRefs', () => {
  it('bringt eine Meldung in feste Form: Arten ergaenzt, Doppel und die Quelle selbst weg', () => {
    expect(
      parseSetRefs(
        {
          source: 'wiki:page:p1',
          targets: [
            'tasks:task:42',
            { ref: 'tasks:task:42', kind: 'derived' },
            'human:Anna@Example.com',
            'wiki:page:p1',
            'group:sales',
          ],
          updatedAt: '2026-11-28T09:00:00.000Z',
          title: '  Meeting\nnotes ',
          path: '/pages/p1',
          actor: 'user:u-ben',
        },
        NOW,
      ),
    ).toEqual({
      source: 'wiki:page:p1',
      targets: [
        { ref: 'tasks:task:42', kind: 'derived' },
        { ref: 'human:anna@example.com', kind: 'mention' },
        { ref: 'group:sales', kind: 'mention' },
      ],
      updatedAt: '2026-11-28T09:00:00.000Z',
      title: 'Meeting notes',
      path: '/pages/p1',
      actor: 'user:u-ben',
    } satisfies SetRefsPayload);
  });

  it('derived gewinnt gegen link, auch in umgekehrter Reihenfolge', () => {
    const parsed = parseSetRefs(
      {
        source: 'tasks:task:1',
        targets: [{ ref: 'wiki:page:p1', kind: 'derived' }, 'wiki:page:p1'],
        updatedAt: NOW,
      },
      NOW,
    );
    expect(parsed.targets).toEqual([{ ref: 'wiki:page:p1', kind: 'derived' }]);
  });

  it('weist falsche Formen ab, bevor etwas geschrieben wird', () => {
    const base = { source: 'wiki:page:p1', targets: [], updatedAt: '2026-11-28T09:00:00.000Z' };
    for (const bad of [
      { ...base, source: 'human:anna@example.com' },
      { ...base, source: 'platform:page:1' },
      { ...base, targets: ['nope'] },
      { ...base, targets: [{ ref: 'human:a@b.c', kind: 'link' }] },
      { ...base, targets: [{ ref: 'tasks:task:1', kind: 'mention' }] },
      { ...base, targets: [{ ref: 'tasks:task:1', extra: true }] },
      { ...base, targets: Array.from({ length: 201 }, (_, i) => `tasks:task:${String(i)}`) },
      { ...base, updatedAt: 'yesterday' },
      { ...base, updatedAt: '2026-11-29T10:00:00.000Z' },
      { ...base, path: 'https://evil.invalid/' },
      { ...base, actor: 'someone' },
      { ...base, content: 'the whole page' },
    ]) {
      expect(() => parseSetRefs(bad, NOW), JSON.stringify(bad).slice(0, 80)).toThrow(
        RefsInputError,
      );
    }
  });

  it('nimmt eine leere Menge an: Das loescht auf der Plattform', () => {
    expect(
      parseSetRefs({ source: 'wiki:page:p1', targets: [], updatedAt: NOW }, NOW).targets,
    ).toEqual([]);
  });
});

describe('refTargetsFromText und extractRefs', () => {
  it('sammelt Verweise aus mehreren Texten ohne Doppel', () => {
    expect(
      refTargetsFromText('A @{tasks:task:1}', null, 'B @{tasks:task:1} @{human:x@y.z}'),
    ).toEqual(['tasks:task:1', 'human:x@y.z']);
    expect(extractRefs('@{crm:deal:d1}')[0]?.kind).toBe('object');
  });

  it('ownRef formatiert eigene Objekte und wirft bei ungueltigen', () => {
    expect(ownRef('tasks', 'task', 'abc').ref).toBe('tasks:task:abc');
    expect(() => ownRef('tasks', 'task', 'a:b')).toThrow(RefsInputError);
  });
});

describe('Resolver-Vertrag', () => {
  it('prueft Argumente des Resolvers', () => {
    expect(parseResolveArgs({ type: 'task', ids: ['a', 'a', 'b'] }, ['task'])).toEqual({
      type: 'task',
      ids: ['a', 'b'],
    });
    for (const bad of [
      null,
      { type: 'task' },
      { type: 'task', ids: [] },
      { type: 'deal', ids: ['a'] },
      { type: 'task', ids: Array.from({ length: 51 }, (_, i) => String(i)) },
      { type: 'task', ids: ['a'], query: 'x' },
    ]) {
      expect(() => parseResolveArgs(bad, ['task']), JSON.stringify(bad)).toThrow(ToolInputError);
    }
  });

  it('nimmt aus der Antwort nur gefragte Ids mit Titel und Pfad in der App', () => {
    const result = normalizeResolveResult(
      {
        objects: [
          { id: 'a', title: 'Write offer', path: '/task/a', status: 'Done', updatedAt: NOW },
          { id: 'b', title: 'Other', path: 'https://evil.invalid/' },
          { id: 'c', title: 'Not asked for', path: '/task/c' },
          { id: 'd', title: '   ', path: '/task/d' },
        ],
      },
      ['a', 'b', 'd'],
    );
    expect([...(result?.keys() ?? [])]).toEqual(['a']);
    expect(result?.get('a')).toMatchObject({ title: 'Write offer', status: 'Done' });
    expect(normalizeResolveResult({ hits: [] }, ['a'])).toBeNull();
  });
});

describe('createRefsOutbox', () => {
  it('prueft vor dem Schreiben und ersetzt eine wartende Meldung derselben Quelle', async () => {
    const statements: { sql: string; params: readonly unknown[] }[] = [];
    const q: OutboxQuery = async (sql, params = []) => {
      statements.push({ sql, params });
      return [];
    };
    const refs = createRefsOutbox({ query: q });
    await expect(
      refs.report(q, { source: 'nope', targets: [], updatedAt: '2020-01-01T09:00:00.000Z' }),
    ).rejects.toThrow(RefsInputError);
    expect(statements).toEqual([]);

    await refs.report(q, {
      source: 'wiki:page:p1',
      targets: ['tasks:task:1'],
      updatedAt: '2020-01-01T09:00:00.000Z',
    });
    expect(statements).toHaveLength(1);
    expect(statements[0]?.sql).toContain('insert into refs_outbox (key, payload)');
    expect(statements[0]?.sql).toContain('do update');
    expect(statements[0]?.params[0]).toEqual(['wiki:page:p1']);
  });

  it('liefert die gepruefte Form an den angegebenen Weg', async () => {
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
      if (sql.startsWith('select count')) return [{ n: rows.length } as unknown as R];
      if (sql.includes('select')) return rows as unknown as R[];
      if (sql.startsWith('delete')) rows.splice(0, rows.length);
      return [];
    };
    const sent: SetRefsPayload[] = [];
    const refs = createRefsOutbox({
      query: q,
      send: async (payload) => {
        sent.push(payload);
      },
    });
    await refs.report(q, {
      source: 'tasks:task:t1',
      targets: [{ ref: 'wiki:page:p1', kind: 'derived' }],
      updatedAt: '2020-01-01T09:00:00.000Z',
    });
    const report = await refs.deliverPending();
    expect(report.delivered).toBe(1);
    expect(sent[0]?.targets).toEqual([{ ref: 'wiki:page:p1', kind: 'derived' }]);
  });
});
