import { describe, expect, it } from 'vitest';
import { parseSetRefs } from '@openapps/sdk';
import { acceptedSource, resolveTaskObjects, taskRefsReport } from './refs';
import { titleFromExcerpt } from './tasks';

/**
 * Verweise in Tasks (ADR 0023), ohne Datenbank. Riskant: eine Quelle, die
 * keine Wiki-Seite und kein Deal ist; eine Meldung, die die Plattform
 * ablehnen wuerde; ein Resolver, der fremde Ids an die Datenbank gibt.
 */

describe('taskRefsReport', () => {
  it('meldet die ganze Menge: Quelle derived, dann Beschreibung und Kommentare', () => {
    const report = taskRefsReport({
      id: '0d000000-0000-4000-8000-000000000001',
      title: 'Ship it',
      description: 'From @{wiki:page:p1}, ask @{human:Kim@example.com}',
      sourceRef: 'wiki:page:p1',
      comments: ['See @{crm:deal:d1}', 'no ref here'],
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      actor: 'viewer@local.test',
    });
    const parsed = parseSetRefs(report, new Date('2026-01-02T00:00:00.000Z'));
    expect(parsed).toMatchObject({
      source: 'tasks:task:0d000000-0000-4000-8000-000000000001',
      path: '/task/0d000000-0000-4000-8000-000000000001',
      actor: 'human:viewer@local.test',
    });
    expect(parsed.targets).toEqual([
      { ref: 'wiki:page:p1', kind: 'derived' },
      { ref: 'human:kim@example.com', kind: 'mention' },
      { ref: 'crm:deal:d1', kind: 'link' },
    ]);
  });
});

describe('acceptedSource und titleFromExcerpt', () => {
  it('nimmt nur Wiki-Seiten und Deals als Quelle', () => {
    expect(acceptedSource('wiki:page:p1')).toBe('wiki:page:p1');
    expect(acceptedSource('crm:deal:d1')).toBe('crm:deal:d1');
    for (const bad of ['tasks:task:1', 'crm:contact:1', 'human:a@b.c', 'nope']) {
      expect(acceptedSource(bad), bad).toBeNull();
    }
  });

  it('nimmt die erste Textzeile ohne Markdown und Verweise als Titel', () => {
    expect(titleFromExcerpt('## Ship the offer\nmore')).toBe('Ship the offer');
    expect(titleFromExcerpt('\n\n- @{human:a@b.c} call back')).toBe('call back');
    expect(titleFromExcerpt('')).toBe('Follow up');
    expect(titleFromExcerpt('x'.repeat(300))).toHaveLength(200);
  });
});

describe('resolveTaskObjects', () => {
  it('fragt die Datenbank nicht nach Ids, die keine UUID sind', async () => {
    const seen: unknown[] = [];
    const q = (async (_sql: string, params: readonly unknown[] = []) => {
      seen.push(params);
      return [];
    }) as Parameters<typeof resolveTaskObjects>[0];
    expect(await resolveTaskObjects(q, { type: 'task', ids: ["1' or 1=1", 'abc'] })).toEqual({
      objects: [],
    });
    expect(seen).toEqual([]);
  });
});
