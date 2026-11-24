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
const AGENT = 'agent:redaktion';

const create = (input: unknown, actor = HUMAN) => createPage(PagesCreateArgs.parse(input), actor);
const update = (input: unknown, actor = AGENT) => updatePage(PagesUpdateArgs.parse(input), actor);

describe.skipIf(!enabled)('Wiki gegen Postgres', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.DATABASE_SCHEMA = schema;
    await runMigrations(appPool(), MIGRATIONS);
    await runSeeds(appPool(), SEEDS, { OPENAPPS_SAMPLE_DATA: '1' });
  });

  afterAll(async () => {
    await appPool().end();
  });

  it('Migrationen laufen ein zweites Mal ohne Wirkung', async () => {
    const result = await runMigrations(appPool(), join(MIGRATIONS));
    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual(['0001_wiki.sql']);
  });

  it('die Beispielseiten stehen als Baum da, mit erstem Verlaufseintrag', async () => {
    const { pages } = await listPages({});
    const handbuch = pages.find((page) => page.title === 'Nordlicht Handbuch');
    expect(handbuch).toBeDefined();
    const children = await listPages({ parentId: handbuch?.id });
    expect(children.pages.map((page) => page.title)).toEqual([
      'Onboarding',
      'Tools & Zugänge',
      'Urlaubsregel',
    ]);
    const history = await pageHistory({ id: handbuch?.id ?? '', limit: 50 });
    expect(history.revisions.map((revision) => revision.change)).toEqual(['create']);
  });

  it('Volltextsuche findet Wortformen und liefert Rang und Ausschnitt', async () => {
    const { hits } = await searchPages({ query: 'Urlaubstagen beantragen', limit: 5 });
    expect(hits[0]?.title).toBe('Urlaubsregel');
    expect(hits[0]?.rank).toBeGreaterThan(0);
    expect(hits[0]?.snippet).toContain('«Urlaubstage»');
    expect(hits[0]?.snippet).not.toContain('\n');
  });

  it('Suche uebersteht Stoppwoerter und kaputte Syntax', async () => {
    expect((await searchPages({ query: 'und', limit: 5 })).hits).toEqual([]);
    await expect(searchPages({ query: '"offen -or ) ( \\', limit: 5 })).resolves.toBeDefined();
  });

  it('Titel-Filter nimmt % und _ woertlich', async () => {
    expect((await listPages({ q: '%' })).pages).toEqual([]);
  });

  it('jede Aenderung schreibt eine Revision mit Autor, keine Aenderung keine', async () => {
    const page = await create({ title: 'Testseite Verlauf', contentMd: 'Start', tags: ['Test'] });
    expect(page.createdBy).toBe(HUMAN);
    expect(page.tags).toEqual(['test']);

    const appended = await update({ id: page.id, appendMd: '- vom Agent ergänzt' });
    expect(appended.contentMd).toBe('Start\n\n- vom Agent ergänzt');
    expect(appended.updatedBy).toBe(AGENT);

    await update({ id: page.id, title: 'Testseite Verlauf' });

    const replaced = await update({ id: page.id, contentMd: 'Neu', tags: [] }, HUMAN);
    expect(replaced.contentMd).toBe('Neu');
    expect(replaced.tags).toEqual([]);

    const history = await pageHistory({ id: page.id, limit: 50 });
    expect(history.revisions.map((revision) => [revision.change, revision.editedBy])).toEqual([
      ['update', HUMAN],
      ['update', AGENT],
      ['create', HUMAN],
    ]);
    expect(history.revisions[1]?.contentMd).toBe('Start\n\n- vom Agent ergänzt');
  });

  it('Anhaengen ueber die Grenze wird abgewiesen, ohne etwas zu schreiben', async () => {
    const page = await create({ title: 'Testseite Grenze', contentMd: 'x'.repeat(199_990) });
    await expect(update({ id: page.id, appendMd: 'y'.repeat(20) })).rejects.toBeInstanceOf(
      ToolInputError,
    );
    expect((await getPage({ id: page.id })).contentMd.length).toBe(199_990);
    expect((await pageHistory({ id: page.id, limit: 50 })).revisions).toHaveLength(1);
  });

  it('Archivieren: nicht mit lebenden Unterseiten, danach unsichtbar in Liste und Suche', async () => {
    const parent = await create({ title: 'Testseite Eltern', contentMd: 'Zebrastreifen' });
    const child = await create({ title: 'Testseite Kind', contentMd: '', parentId: parent.id });
    expect((await getPage({ id: parent.id })).children).toEqual([
      { id: child.id, title: 'Testseite Kind' },
    ]);

    await expect(archivePage({ id: parent.id }, AGENT)).rejects.toThrow(/Unterseiten/);

    const archivedChild = await archivePage({ id: child.id }, AGENT);
    const again = await archivePage({ id: child.id }, AGENT);
    expect(again.archivedAt).toBe(archivedChild.archivedAt);

    await archivePage({ id: parent.id }, AGENT);
    expect((await listPages({})).pages.some((page) => page.id === parent.id)).toBe(false);
    expect((await searchPages({ query: 'Zebrastreifen', limit: 5 })).hits).toEqual([]);

    const archived = await getPage({ id: parent.id });
    expect(archived.archivedAt).not.toBeNull();
    expect(archived.children).toEqual([]);

    const history = await pageHistory({ id: child.id, limit: 50 });
    expect(history.revisions.map((revision) => revision.change)).toEqual(['archive', 'create']);
    expect((await pageHistory({ id: child.id, limit: 50 })).revisions[0]?.editedBy).toBe(AGENT);

    await expect(update({ id: parent.id, title: 'x' })).rejects.toBeInstanceOf(ToolInputError);
    await expect(
      create({ title: 'Waise', contentMd: '', parentId: parent.id }),
    ).rejects.toBeInstanceOf(ToolInputError);
  });

  it('unbekannte Seiten ergeben ToolNotFoundError, nie einen Datenbankfehler', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';
    await expect(getPage({ id: missing })).rejects.toBeInstanceOf(ToolNotFoundError);
    await expect(update({ id: missing, title: 'x' })).rejects.toBeInstanceOf(ToolNotFoundError);
    await expect(archivePage({ id: missing }, AGENT)).rejects.toBeInstanceOf(ToolNotFoundError);
    await expect(pageHistory({ id: missing, limit: 5 })).rejects.toBeInstanceOf(ToolNotFoundError);
    await expect(
      create({ title: 'Waise', contentMd: '', parentId: missing }),
    ).rejects.toBeInstanceOf(ToolNotFoundError);
  });

  it('die Revisionen bleiben, auch wenn jemand am Code vorbei loeschen will', async () => {
    const page = await create({ title: 'Testseite Loeschen', contentMd: '' });
    await expect(query('delete from pages where id = $1', [page.id])).rejects.toThrow();
  });
});
