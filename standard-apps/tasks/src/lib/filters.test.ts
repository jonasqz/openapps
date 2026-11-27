import { describe, expect, it } from 'vitest';
import { TaskListArgs } from './schemas';
import { filtersToQuery, parseFilters, toListArgs } from './filters';

/** Die Adresse ist Eingabe aus dem Browser: Unbekanntes faellt weg. */
describe('parseFilters', () => {
  it('liest gueltige Filter', () => {
    const filters = parseFilters({
      status: 'in_progress',
      assignee: 'Sam@Example.com',
      project: '0e000000-0000-4000-8000-000000000001',
      overdue: '1',
    });
    expect(filters).toEqual({
      status: 'in_progress',
      assignee: 'sam@example.com',
      project: '0e000000-0000-4000-8000-000000000001',
      overdue: true,
    });
  });

  it('verwirft unbekannte und fremde Werte, statt zu werfen', () => {
    expect(
      parseFilters({ status: 'closed', assignee: "x' or 1=1 --", project: 'website', overdue: 'yes' }),
    ).toEqual({ status: '', assignee: '', project: '', overdue: false });
  });

  it('nimmt bei doppelten Parametern den ersten', () => {
    expect(parseFilters({ status: ['done', 'todo'] }).status).toBe('done');
  });
});

describe('toListArgs', () => {
  it('ergibt immer Argumente, die tasks.list annimmt', () => {
    for (const status of ['', 'open', 'todo', 'done']) {
      for (const assignee of ['', 'me', 'none', 'sam@example.com']) {
        const args = toListArgs(parseFilters({ status, assignee, overdue: '1' }), 200);
        expect(TaskListArgs.safeParse(args).success, `${status} ${assignee}`).toBe(true);
      }
    }
  });

  it('macht aus open "nicht erledigt" und aus me "mir zugewiesen"', () => {
    expect(toListArgs(parseFilters({ status: 'open', assignee: 'me' }), 50)).toEqual({
      limit: 50,
      completed: false,
      mine: true,
    });
  });
});

describe('filtersToQuery', () => {
  it('laesst leere Filter weg', () => {
    expect(filtersToQuery(parseFilters({}))).toBe('');
    expect(filtersToQuery(parseFilters({ status: 'open', overdue: '1' }))).toBe('?status=open&overdue=1');
  });
});
