import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations, runSeeds, ToolInputError, ToolNotFoundError } from '@openapps/sdk';
import { appPool, query } from './db';
import {
  archivePage,
  createPage,
  getPage,
  listPages,
  pageHistory,
  searchPages,
  updatePage,
} from './pages';
import { PagesCreateArgs, PagesUpdateArgs } from './schemas';

/**
 * Gegen eine echte Datenbank. Laeuft nur, wenn `WIKI_TEST_DATABASE_URL` und
 * `WIKI_TEST_DATABASE_SCHEMA` gesetzt sind — sonst uebersprungen, nicht
 * gescheitert. Die Verbindung muss die App-Rolle sein (kein Owner, kein
 * Superuser), mit einem eigenen, leeren Schema, das ihr gehoert.
 *
 *   WIKI_TEST_DATABASE_URL=postgres://app_wiki:…@localhost:55432/openapps_test \
 *   WIKI_TEST_DATABASE_SCHEMA=app_wiki pnpm --filter @openapps/app-wiki test
 */
const url = process.env.WIKI_TEST_DATABASE_URL ?? '';
const schema = process.env.WIKI_TEST_DATABASE_SCHEMA ?? '';
const enabled = url !== '' && schema !== '';

const MIGRATIONS = fileURLToPath(new URL('../../migrations', import.meta.url));
const SEEDS = fileURLToPath(new URL('../../seeds', import.meta.url));
const HUMAN = 'usr_test';
const AGENT = 'agent:editor';

const create = (input: unknown, actor = HUMAN) => createPage(PagesCreateArgs.parse(input), actor);
const update = (input: unknown, actor = AGENT) => updatePage(PagesUpdateArgs.parse(input), actor);

describe.skipIf(!enabled)('Wiki against Postgres', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.DATABASE_SCHEMA = schema;
    await runMigrations(appPool(), MIGRATIONS);
    await runSeeds(appPool(), SEEDS, { OPENAPPS_SAMPLE_DATA: '1' });
  });

  afterAll(async () => {
    await appPool().end();
  });

  it('runs migrations a second time without effect', async () => {
    const result = await runMigrations(appPool(), join(MIGRATIONS));
    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual(['0001_wiki.sql', '0002_english_search.sql']);
  });

  it('shows the sample pages as a tree, each with a first history entry', async () => {
    const { pages } = await listPages({});
    const handbuch = pages.find((page) => page.title === 'Northlight Handbook');
    expect(handbuch).toBeDefined();
    const children = await listPages({ parentId: handbuch?.id });
    expect(children.pages.map((page) => page.title)).toEqual([
      'Leave policy',
      'Onboarding',
      'Tools & access',
    ]);
    const history = await pageHistory({ id: handbuch?.id ?? '', limit: 50 });
    expect(history.revisions.map((revision) => revision.change)).toEqual(['create']);
  });

  it('full-text search finds word forms and returns rank and snippet', async () => {
    // "requests" in der Suche, "request" im Text.
    const { hits } = await searchPages({ query: 'annual leave requests', limit: 5 });
    expect(hits[0]?.title).toBe('Leave policy');
    expect(hits[0]?.rank).toBeGreaterThan(0);
    expect(hits[0]?.snippet).toContain('«request»');
    expect(hits[0]?.snippet).not.toContain('\n');
  });

  it('search uses English stemming', async () => {
    // "policies" und "policy" haben nur im englischen Woerterbuch denselben Stamm.
    const { hits } = await searchPages({ query: 'policies', limit: 5 });
    expect(hits.map((hit) => hit.title)).toContain('Leave policy');
  });

  it('search survives stop words and broken syntax', async () => {
    // Der Suchindex nutzt das englische Woerterbuch (0002_english_search.sql).
    expect((await searchPages({ query: 'the', limit: 5 })).hits).toEqual([]);
    await expect(searchPages({ query: '"open -or ) ( \\', limit: 5 })).resolves.toBeDefined();
  });

  it('title filter takes % and _ literally', async () => {
    expect((await listPages({ q: '%' })).pages).toEqual([]);
  });

  it('writes a revision with author for every change, and none without a change', async () => {
    const page = await create({ title: 'Test page history', contentMd: 'Start', tags: ['Test'] });
    expect(page.createdBy).toBe(HUMAN);
    expect(page.tags).toEqual(['test']);

    const appended = await update({ id: page.id, appendMd: '- added by the agent' });
    expect(appended.contentMd).toBe('Start\n\n- added by the agent');
    expect(appended.updatedBy).toBe(AGENT);

    await update({ id: page.id, title: 'Test page history' });

    const replaced = await update({ id: page.id, contentMd: 'New', tags: [] }, HUMAN);
    expect(replaced.contentMd).toBe('New');
    expect(replaced.tags).toEqual([]);

    const history = await pageHistory({ id: page.id, limit: 50 });
    expect(history.revisions.map((revision) => [revision.change, revision.editedBy])).toEqual([
      ['update', HUMAN],
      ['update', AGENT],
      ['create', HUMAN],
    ]);
    expect(history.revisions[1]?.contentMd).toBe('Start\n\n- added by the agent');
  });

  it('rejects appending past the limit without writing anything', async () => {
    const page = await create({ title: 'Test page limit', contentMd: 'x'.repeat(199_990) });
    await expect(update({ id: page.id, appendMd: 'y'.repeat(20) })).rejects.toBeInstanceOf(
      ToolInputError,
    );
    expect((await getPage({ id: page.id })).contentMd.length).toBe(199_990);
    expect((await pageHistory({ id: page.id, limit: 50 })).revisions).toHaveLength(1);
  });

  it('archive: not with live subpages, afterwards hidden from list and search', async () => {
    const parent = await create({ title: 'Test page parent', contentMd: 'Zebracrossing' });
    const child = await create({ title: 'Test page child', contentMd: '', parentId: parent.id });
    expect((await getPage({ id: parent.id })).children).toEqual([
      { id: child.id, title: 'Test page child' },
    ]);

    await expect(archivePage({ id: parent.id }, AGENT)).rejects.toThrow(/subpages/);

    const archivedChild = await archivePage({ id: child.id }, AGENT);
    const again = await archivePage({ id: child.id }, AGENT);
    expect(again.archivedAt).toBe(archivedChild.archivedAt);

    await archivePage({ id: parent.id }, AGENT);
    expect((await listPages({})).pages.some((page) => page.id === parent.id)).toBe(false);
    expect((await searchPages({ query: 'Zebracrossing', limit: 5 })).hits).toEqual([]);

    const archived = await getPage({ id: parent.id });
    expect(archived.archivedAt).not.toBeNull();
    expect(archived.children).toEqual([]);

    const history = await pageHistory({ id: child.id, limit: 50 });
    expect(history.revisions.map((revision) => revision.change)).toEqual(['archive', 'create']);
    expect((await pageHistory({ id: child.id, limit: 50 })).revisions[0]?.editedBy).toBe(AGENT);

    await expect(update({ id: parent.id, title: 'x' })).rejects.toBeInstanceOf(ToolInputError);
    await expect(
      create({ title: 'Orphan', contentMd: '', parentId: parent.id }),
    ).rejects.toBeInstanceOf(ToolInputError);
  });

  it('unknown pages yield ToolNotFoundError, never a database error', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';
    await expect(getPage({ id: missing })).rejects.toBeInstanceOf(ToolNotFoundError);
    await expect(update({ id: missing, title: 'x' })).rejects.toBeInstanceOf(ToolNotFoundError);
    await expect(archivePage({ id: missing }, AGENT)).rejects.toBeInstanceOf(ToolNotFoundError);
    await expect(pageHistory({ id: missing, limit: 5 })).rejects.toBeInstanceOf(ToolNotFoundError);
    await expect(
      create({ title: 'Orphan', contentMd: '', parentId: missing }),
    ).rejects.toBeInstanceOf(ToolNotFoundError);
  });

  it('keeps the revisions even if someone tries to delete around the code', async () => {
    const page = await create({ title: 'Test page delete', contentMd: '' });
    await expect(query('delete from pages where id = $1', [page.id])).rejects.toThrow();
  });
});
