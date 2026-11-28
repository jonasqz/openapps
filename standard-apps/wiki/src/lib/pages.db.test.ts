import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppCallError, runMigrations, runSeeds, ToolInputError, ToolNotFoundError } from '@openapps/sdk';
import { appPool, query } from './db';
import {
  archivePage,
  createPage,
  getPage,
  isFavorite,
  listFavorites,
  listPages,
  movePage,
  pageHistory,
  pageTree,
  restorePage,
  searchPages,
  setFavorite,
  updatePage,
} from './pages';
import { PagesCreateArgs, PagesMoveArgs, PagesUpdateArgs } from './schemas';
import {
  backfillIfFirstRun,
  backfillSearch,
  kickSearchSync,
  searchSyncStatus,
  setSearchDeliverer,
  settleSearchSync,
  type Deliverer,
  type UpsertPayload,
} from './search-sync';
import { flattenTree } from './tree';

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
const move = (id: string, parentId: string | null, actor = AGENT) =>
  movePage(PagesMoveArgs.parse({ id, parentId }), actor);

describe.skipIf(!enabled)('Wiki against Postgres', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.DATABASE_SCHEMA = schema;
    await runMigrations(appPool(), MIGRATIONS);
    await runSeeds(appPool(), SEEDS, { OPENAPPS_SAMPLE_DATA: '1' });
  });

  afterAll(async () => {
    await settleSearchSync();
    await appPool().end();
  });

  it('runs migrations a second time without effect', async () => {
    const result = await runMigrations(appPool(), join(MIGRATIONS));
    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual([
      '0001_wiki.sql',
      '0002_english_search.sql',
      '0003_history_moves_restores.sql',
      '0004_favorites.sql',
      '0005_page_links.sql',
      '0006_search_outbox.sql',
      '0007_event_outbox.sql',
      '0008_refs_outbox.sql',
    ]);
  });

  it('queues the full set of references of a page and the empty set once it is archived (ADR 0023)', async () => {
    const { wikiRefs } = await import('./refs');
    await wikiRefs.settle();
    delete process.env.OPENAPPS_PLATFORM_URL;
    await query('delete from refs_outbox');
    const page = await create({ title: 'Plan', contentMd: 'No refs yet' });
    expect(await query('select key from refs_outbox')).toEqual([]);

    await update({ id: page.id, contentMd: 'Ask @{human:kim@example.com} about @{tasks:task:42}' });
    await wikiRefs.settle();
    const queued = await query<{ key: string; targets: string[] }>(
      `select key, array(select t->>'ref' from jsonb_array_elements(payload->'targets') t) as targets
         from refs_outbox`,
    );
    expect(queued).toEqual([
      { key: `wiki:page:${page.id}`, targets: ['human:kim@example.com', 'tasks:task:42'] },
    ]);

    await archivePage({ id: page.id }, AGENT);
    await wikiRefs.settle();
    const archived = await query<{ n: number }>(
      `select jsonb_array_length(payload->'targets')::int as n from refs_outbox where key = $1`,
      [`wiki:page:${page.id}`],
    );
    expect(archived).toEqual([{ n: 0 }]);
  });

  it('queues page.updated for the people who favorited a page, not for the editor (ADR 0022)', async () => {
    const { wikiEvents } = await import('./events');
    await wikiEvents.settle();
    delete process.env.OPENAPPS_PLATFORM_URL;
    await query('delete from event_outbox');
    const page = await create({ title: 'Followed page', contentMd: 'v1' });
    await setFavorite({ id: page.id, favorite: true }, 'usr_follower');
    await setFavorite({ id: page.id, favorite: true }, AGENT);

    await update({ id: page.id, contentMd: 'v2' });
    // Nichts geaendert: keine Revision, kein Ereignis.
    await update({ id: page.id, contentMd: 'v2' });
    await wikiEvents.settle();
    const rows = await query<{ type: string; audience: string[]; actor: string }>(
      `select payload->>'type' as type, array(select jsonb_array_elements_text(payload->'audience')) as audience,
              payload->>'actor' as actor
         from event_outbox`,
    );
    expect(rows).toEqual([{ type: 'page.updated', audience: ['user:usr_follower'], actor: 'agent:editor' }]);
    expect((await getPage({ id: page.id })).contentMd).toBe('v2');
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

  it('backfilled the parent of every existing revision', async () => {
    const { pages } = await listPages({ q: 'Onboarding' });
    const onboarding = pages[0];
    expect(onboarding?.parentId).not.toBeNull();
    const history = await pageHistory({ id: onboarding?.id ?? '', limit: 5 });
    expect(history.revisions[0]?.parentId).toBe(onboarding?.parentId);
  });

  it('sample links in the seed match what the code reads from the content', async () => {
    const { pages } = await listPages({ q: 'First-day checklist' });
    const checklist = await getPage({ id: pages[0]?.id ?? '' });
    const { extractPageLinks } = await import('./markdown');
    const stored = await query<{ target_id: string }>(
      'select target_id from page_links where source_id = $1 order by target_id',
      [checklist.id],
    );
    expect(stored.map((row) => row.target_id)).toEqual([...extractPageLinks(checklist.contentMd)].sort());
    const leave = (await listPages({ q: 'Leave policy' })).pages[0];
    expect((await getPage({ id: leave?.id ?? '' })).backlinks.map((ref) => ref.id)).toEqual([checklist.id]);
  });

  it('move: under another page, to the top level, with breadcrumbs and history', async () => {
    const root = await create({ title: 'Test move root', contentMd: '' });
    const middle = await create({ title: 'Test move middle', contentMd: '', parentId: root.id });
    const leaf = await create({ title: 'Test move leaf', contentMd: '' });

    const moved = await move(leaf.id, middle.id);
    expect(moved.parentId).toBe(middle.id);
    expect(moved.path.map((ref) => ref.id)).toEqual([root.id, middle.id]);
    expect(moved.updatedBy).toBe(AGENT);

    const top = await move(leaf.id, null, HUMAN);
    expect(top.parentId).toBeNull();
    expect(top.path).toEqual([]);

    const history = await pageHistory({ id: leaf.id, limit: 10 });
    expect(history.revisions.map((revision) => [revision.change, revision.parentId])).toEqual([
      ['move', null],
      ['move', middle.id],
      ['create', null],
    ]);

    // Dasselbe Ziel noch einmal: keine neue Revision.
    await move(leaf.id, null);
    expect((await pageHistory({ id: leaf.id, limit: 10 })).revisions).toHaveLength(3);
  });

  it('move: never into its own subtree, not even deep down', async () => {
    const a = await create({ title: 'Test cycle a', contentMd: '' });
    const b = await create({ title: 'Test cycle b', contentMd: '', parentId: a.id });
    const c = await create({ title: 'Test cycle c', contentMd: '', parentId: b.id });

    await expect(move(a.id, b.id)).rejects.toThrow(/own subpages/);
    await expect(move(a.id, c.id)).rejects.toBeInstanceOf(ToolInputError);
    // Nichts wurde geschrieben.
    expect((await getPage({ id: a.id })).parentId).toBeNull();
    expect((await pageHistory({ id: a.id, limit: 5 })).revisions.map((r) => r.change)).toEqual(['create']);

    // Ein Ast weiter oben ist erlaubt: c unter a.
    expect((await move(c.id, a.id)).parentId).toBe(a.id);
  });

  it('move: two crossing moves at the same time cannot build a cycle', async () => {
    const x = await create({ title: 'Test race x', contentMd: '' });
    const y = await create({ title: 'Test race y', contentMd: '' });
    const results = await Promise.allSettled([move(x.id, y.id), move(y.id, x.id)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' ? rejected.reason : undefined).toBeInstanceOf(ToolInputError);
    const [px, py] = await Promise.all([getPage({ id: x.id }), getPage({ id: y.id })]);
    expect(px.parentId === y.id && py.parentId === x.id).toBe(false);
  });

  it('move: not under an archived or unknown page, and archived pages stay put', async () => {
    const gone = await create({ title: 'Test move archived parent', contentMd: '' });
    await archivePage({ id: gone.id }, AGENT);
    const page = await create({ title: 'Test move victim', contentMd: '' });
    await expect(move(page.id, gone.id)).rejects.toThrow(/archived/);
    await expect(move(page.id, '00000000-0000-4000-8000-000000000000')).rejects.toBeInstanceOf(
      ToolNotFoundError,
    );
    await expect(move(gone.id, page.id)).rejects.toThrow(/archived/);
  });

  it('tree: full tree and subtree, without archived pages', async () => {
    const root = await create({ title: 'Test tree root', contentMd: '' });
    const child = await create({ title: 'Test tree child', contentMd: '', parentId: root.id });
    const archived = await create({ title: 'Test tree archived', contentMd: '', parentId: root.id });
    await archivePage({ id: archived.id }, AGENT);

    const sub = await pageTree({ rootId: root.id });
    expect(sub.truncated).toBe(false);
    expect(sub.tree).toHaveLength(1);
    expect(sub.tree[0]?.children.map((node) => node.id)).toEqual([child.id]);

    const full = await pageTree({});
    const ids = flattenTree(full.tree).map((node) => node.id);
    expect(ids).toContain(child.id);
    expect(ids).not.toContain(archived.id);
    expect(new Set(ids).size).toBe(ids.length);

    await expect(pageTree({ rootId: '00000000-0000-4000-8000-000000000000' })).rejects.toBeInstanceOf(
      ToolNotFoundError,
    );
  });

  it('restore: earlier state comes back as a new revision, nothing is lost', async () => {
    const page = await create({ title: 'Test restore', contentMd: 'Version one', tags: ['one'] });
    await update({ id: page.id, title: 'Test restore renamed', contentMd: 'Version two', tags: [] });
    const history = await pageHistory({ id: page.id, limit: 10 });
    const first = history.revisions.find((revision) => revision.change === 'create');

    const restored = await restorePage({ id: page.id, revisionId: first?.id ?? '' }, HUMAN);
    expect(restored.title).toBe('Test restore');
    expect(restored.contentMd).toBe('Version one');
    expect(restored.tags).toEqual(['one']);

    const after = await pageHistory({ id: page.id, limit: 10 });
    expect(after.revisions.map((revision) => [revision.change, revision.editedBy])).toEqual([
      ['restore', HUMAN],
      ['update', AGENT],
      ['create', HUMAN],
    ]);

    // Schon auf diesem Stand: keine weitere Revision.
    await restorePage({ id: page.id, revisionId: first?.id ?? '' }, HUMAN);
    expect((await pageHistory({ id: page.id, limit: 10 })).revisions).toHaveLength(3);
  });

  it('restore: only revisions of the same page, never on archived pages', async () => {
    const a = await create({ title: 'Test restore a', contentMd: 'a' });
    const b = await create({ title: 'Test restore b', contentMd: 'b' });
    const revisionOfB = (await pageHistory({ id: b.id, limit: 1 })).revisions[0]?.id ?? '';
    await expect(restorePage({ id: a.id, revisionId: revisionOfB }, HUMAN)).rejects.toBeInstanceOf(
      ToolNotFoundError,
    );
    expect((await getPage({ id: a.id })).contentMd).toBe('a');
    await expect(restorePage({ id: a.id, revisionId: '999999999999' }, HUMAN)).rejects.toBeInstanceOf(
      ToolNotFoundError,
    );

    await archivePage({ id: b.id }, AGENT);
    await expect(restorePage({ id: b.id, revisionId: revisionOfB }, HUMAN)).rejects.toThrow(/archived/);
  });

  it('backlinks follow the content: added, removed, restored, hidden when archived', async () => {
    const target = await create({ title: 'Test link target', contentMd: '' });
    const source = await create({
      title: 'Test link source',
      contentMd: `See [target](page:${target.id}) and [nothing](page:00000000-0000-4000-8000-000000000000) and [me](page:TARGET).`,
    });
    expect((await getPage({ id: target.id })).backlinks).toEqual([{ id: source.id, title: 'Test link source' }]);

    // Ein Link auf sich selbst zaehlt nicht.
    await update({ id: target.id, contentMd: `[self](page:${target.id})` });
    expect((await getPage({ id: target.id })).backlinks.map((ref) => ref.id)).toEqual([source.id]);

    await update({ id: source.id, contentMd: 'No links any more. `[code](page:' + target.id + ')`' });
    expect((await getPage({ id: target.id })).backlinks).toEqual([]);

    const first = (await pageHistory({ id: source.id, limit: 10 })).revisions.find((r) => r.change === 'create');
    await restorePage({ id: source.id, revisionId: first?.id ?? '' }, HUMAN);
    expect((await getPage({ id: target.id })).backlinks.map((ref) => ref.id)).toEqual([source.id]);

    // Archivierte Quellen zeigen nicht mehr als Rueckverweis.
    await archivePage({ id: source.id }, AGENT);
    expect((await getPage({ id: target.id })).backlinks).toEqual([]);
  });

  it('favorites belong to the caller only, are idempotent and skip archived pages', async () => {
    const page = await create({ title: 'Test favorite', contentMd: '' });
    await setFavorite({ id: page.id, favorite: true }, HUMAN);
    await setFavorite({ id: page.id, favorite: true }, HUMAN);
    expect((await listFavorites(HUMAN)).pages.filter((p) => p.id === page.id)).toHaveLength(1);
    expect(await isFavorite(HUMAN, page.id)).toBe(true);
    // Ein anderer Aufrufer sieht die Favoriten der Person nicht.
    expect((await listFavorites(AGENT)).pages.some((p) => p.id === page.id)).toBe(false);
    expect(await isFavorite(AGENT, page.id)).toBe(false);

    await archivePage({ id: page.id }, AGENT);
    expect((await listFavorites(HUMAN)).pages.some((p) => p.id === page.id)).toBe(false);
    await expect(setFavorite({ id: page.id, favorite: true }, AGENT)).rejects.toThrow(/archived/);
    await expect(setFavorite({ id: page.id, favorite: false }, HUMAN)).resolves.toEqual({
      id: page.id,
      favorite: false,
    });
    await expect(
      setFavorite({ id: '00000000-0000-4000-8000-000000000000', favorite: true }, HUMAN),
    ).rejects.toBeInstanceOf(ToolNotFoundError);
  });

  it('recently edited: newest change first, bounded by limit', async () => {
    const page = await create({ title: 'Test recent', contentMd: '' });
    const { pages, truncated } = await listPages({ sort: 'updated', limit: 1 });
    expect(pages.map((p) => p.id)).toEqual([page.id]);
    expect(truncated).toBe(true);
  });

  it('keeps the revisions even if someone tries to delete around the code', async () => {
    const page = await create({ title: 'Test page delete', contentMd: '' });
    await expect(query('delete from pages where id = $1', [page.id])).rejects.toThrow();
  });
  /* ------------------------------------------------------------------------ */
  /* Gemeinsame Suche: Outbox (ADR 0020)                                       */
  /* ------------------------------------------------------------------------ */

  describe('delivery to the shared search', () => {
    interface Delivered {
      op: 'upsert' | 'remove';
      args: { key: string } & Partial<UpsertPayload>;
    }
    const delivered: Delivered[] = [];
    let failWith: AppCallError | null = null;
    let duringUpsert: ((args: UpsertPayload) => Promise<void>) | null = null;

    const fake: Deliverer = {
      async upsert(args) {
        if (failWith !== null) throw failWith;
        if (duringUpsert !== null) {
          const hook = duringUpsert;
          duringUpsert = null;
          await hook(args);
        }
        delivered.push({ op: 'upsert', args });
        return { status: 'created' };
      },
      async remove(args) {
        if (failWith !== null) throw failWith;
        delivered.push({ op: 'remove', args });
        return { removed: true };
      },
    };

    const outboxRow = async (pageId: string) =>
      (
        await query<{ attempts: number; last_error: string | null }>(
          'select attempts, last_error from search_outbox where page_id = $1',
          [pageId],
        )
      )[0];

    const deliveredFor = (pageId: string) => delivered.filter((d) => d.args.key === pageId);

    beforeEach(async () => {
      await settleSearchSync();
      setSearchDeliverer(fake);
      delivered.length = 0;
      failWith = null;
      duringUpsert = null;
    });

    afterAll(async () => {
      await settleSearchSync();
      setSearchDeliverer(undefined);
    });

    it('saves even when Knowledge is unreachable, and keeps the page in the outbox', async () => {
      failWith = new AppCallError('unreachable', 'knowledge.documents.upsert: not reachable', 502);
      const page = await create({ title: 'Sync unreachable', contentMd: 'Text' });
      await settleSearchSync();
      expect((await getPage({ id: page.id })).title).toBe('Sync unreachable');
      const row = await outboxRow(page.id);
      expect(row?.attempts).toBeGreaterThanOrEqual(1);
      expect(row?.last_error).toContain('unreachable');
      expect(deliveredFor(page.id)).toEqual([]);
    });

    it('saves even without the grant, and delivers once it is there', async () => {
      failWith = new AppCallError('denied', 'app:wiki may not call "knowledge.documents.upsert"', 403);
      const page = await create({ title: 'Sync denied', contentMd: 'Inhalt' });
      await settleSearchSync();
      expect((await outboxRow(page.id))?.last_error).toContain('denied');

      // Die Freigabe ist da: der naechste Anstoss liefert, ohne neue Aenderung.
      failWith = null;
      kickSearchSync();
      await settleSearchSync();
      expect(await outboxRow(page.id)).toBeUndefined();
      const [entry] = deliveredFor(page.id);
      expect(entry?.op).toBe('upsert');
      expect(entry?.args).toMatchObject({
        key: page.id,
        title: 'Sync denied',
        path: `/pages/${page.id}`,
        source: 'Wiki › Sync denied',
      });
      expect(entry?.args.content).toBe('Sync denied\n\nInhalt');
    });

    it('a failing database write leaves nothing in the outbox', async () => {
      const parent = await create({ title: 'Sync parent archived', contentMd: '' });
      await archivePage({ id: parent.id }, AGENT);
      await expect(
        create({ title: 'Sync child', contentMd: '', parentId: parent.id }),
      ).rejects.toBeInstanceOf(ToolInputError);
      const rows = await query<{ n: number }>(
        `select count(*)::int as n from search_outbox o join pages p on p.id = o.page_id
          where p.title = 'Sync child'`,
      );
      expect(rows[0]?.n).toBe(0);
    });

    it('loses no change that happens while a page is being delivered', async () => {
      const page = await create({ title: 'Sync race v1', contentMd: '' });
      await settleSearchSync();
      delivered.length = 0;
      // Waehrend v2 geliefert wird, kommt v3.
      duringUpsert = async () => {
        await update({ id: page.id, title: 'Sync race v3' });
      };
      await update({ id: page.id, title: 'Sync race v2' });
      await settleSearchSync();
      kickSearchSync();
      await settleSearchSync();
      expect(await outboxRow(page.id)).toBeUndefined();
      const titles = deliveredFor(page.id).map((d) => d.args.title);
      expect(titles.at(-1)).toBe('Sync race v3');
    });

    it('removes archived pages and re-delivers subpages after a rename or move', async () => {
      const parent = await create({ title: 'Sync handbook', contentMd: '' });
      const child = await create({ title: 'Sync chapter', contentMd: '', parentId: parent.id });
      await settleSearchSync();
      delivered.length = 0;

      await update({ id: parent.id, title: 'Sync manual' });
      await settleSearchSync();
      expect(deliveredFor(child.id).at(-1)?.args.source).toBe('Wiki › Sync manual › Sync chapter');

      delivered.length = 0;
      await move(child.id, null);
      await settleSearchSync();
      expect(deliveredFor(child.id).at(-1)?.args.source).toBe('Wiki › Sync chapter');

      delivered.length = 0;
      await archivePage({ id: child.id }, AGENT);
      await settleSearchSync();
      expect(deliveredFor(child.id)).toEqual([{ op: 'remove', args: { key: child.id } }]);
    });

    it('restoring a revision delivers the restored state', async () => {
      const page = await create({ title: 'Sync restore', contentMd: 'Erste Fassung' });
      await update({ id: page.id, contentMd: 'Zweite Fassung' });
      await settleSearchSync();
      delivered.length = 0;
      const { revisions } = await pageHistory({ id: page.id, limit: 50 });
      const first = revisions.find((r) => r.change === 'create');
      if (first === undefined) throw new Error('no create revision');
      await restorePage({ id: page.id, revisionId: first.id }, HUMAN);
      await settleSearchSync();
      expect(deliveredFor(page.id).at(-1)?.args.content).toBe('Sync restore\n\nErste Fassung');
    });

    it('queues every page once on the first run, and search.backfill again on demand', async () => {
      await query('update search_sync set backfilled_at = null');
      const queued = await backfillIfFirstRun();
      const total = await query<{ n: number }>('select count(*)::int as n from pages');
      expect(queued).toBe(total[0]?.n);
      expect(await backfillIfFirstRun()).toBeNull();

      const result = await backfillSearch();
      expect(result.queued).toBe(total[0]?.n);
      expect(result.pending).toBe(0);
      expect(result.failed).toBe(0);
      const status = await searchSyncStatus();
      expect(status.pending).toBe(0);
      expect(status.backfilledAt).not.toBeNull();
    });

    it('search.status names the stuck pages and the reason', async () => {
      failWith = new AppCallError('denied', 'app:wiki may not call "knowledge.documents.upsert"', 403);
      const page = await create({ title: 'Sync status', contentMd: '' });
      await settleSearchSync();
      const status = await searchSyncStatus();
      expect(status.pending).toBeGreaterThanOrEqual(1);
      expect(status.errors.some((e) => e.pageId === page.id && e.lastError?.includes('denied'))).toBe(
        true,
      );
    });
  });
});
