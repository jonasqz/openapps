import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeSearchResult } from '@openapps/sdk';
import { parseAppManifest } from '@openapps/app-manifest';
import { SearchArgs } from './schemas';
import { searchTasks, TASK_SEARCH_SQL, toTaskSearchHit, type TaskSearchRow } from './task-search';

/**
 * Das Such-Tool fuer die Suche ueber alle Apps (ADR 0021), ohne Datenbank.
 */

const manifest = parseAppManifest(JSON.parse(readFileSync(new URL('../../app.json', import.meta.url), 'utf8')));

const ID = '5c0d1e2f-3a4b-4c5d-8e6f-7a8b9c0d1e2f';

function row(kind: TaskSearchRow['kind'], extra: Partial<TaskSearchRow> = {}): TaskSearchRow {
  return { kind, id: ID, title: 'Prepare offer', status: null, detail: null, score: 0, ...extra };
}

describe('search', () => {
  it('ist das lesende Such-Tool im Manifest', () => {
    expect(manifest.search).toEqual({ tool: 'search' });
    expect(manifest.offeredTools.find((tool) => tool.name === 'search')?.verb).toBe('read');
  });

  it('weist leere, zu lange und unbekannte Argumente vor der Datenbank ab', () => {
    expect(SearchArgs.safeParse({ query: '' }).success).toBe(false);
    expect(SearchArgs.safeParse({ query: 'x'.repeat(201) }).success).toBe(false);
    expect(SearchArgs.safeParse({ query: 'x', limit: 0 }).success).toBe(false);
    expect(SearchArgs.safeParse({ query: 'x', mine: true }).success).toBe(false);
    expect(SearchArgs.parse({ query: ' offer ' })).toEqual({ query: 'offer', limit: 5 });
  });

  it('nimmt % und _ als Zeichen und den Suchtext nur als Parameter', async () => {
    const calls: unknown[][] = [];
    const fake = async <Row extends Record<string, unknown>>(_sql: string, params: readonly unknown[] = []) => {
      calls.push([...params]);
      return [] as Row[];
    };
    await searchTasks(fake, { query: '50%_off', limit: 4 });
    expect(calls[0]).toEqual(['%50\\%\\_off%', '50\\%\\_off%', 4]);
    expect(TASK_SEARCH_SQL).not.toContain('50');
  });

  it('verlinkt Aufgaben auf ihre Seite und Projekte auf die gefilterte Liste', () => {
    const task = toTaskSearchHit(row('task', { status: 'in_progress', detail: 'Website' }));
    const project = toTaskSearchHit(row('project', { id: 'p1', title: 'Website', detail: 'Relaunch' }));
    expect(task).toEqual({
      id: ID,
      title: 'Prepare offer',
      url: `/task/${ID}`,
      kind: 'task',
      snippet: 'In progress · Website',
    });
    expect(project).toMatchObject({ url: '/all?project=p1', kind: 'project', snippet: 'Relaunch' });
    expect(normalizeSearchResult({ hits: [task, project] }, 5)).toHaveLength(2);
  });
});
