import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations, ToolInputError, ToolNotFoundError } from '@openapps/sdk';
import { appPool, query } from '@/lib/db';
import {
  addDocument,
  deleteDocument,
  getDocument,
  listDocuments,
  removeSourceDocument,
  upsertSourceDocument,
} from '@/lib/documents';
import { createFulltextRetriever } from '@/lib/retriever';
import { DocumentInput, UpsertArgs } from '@/lib/schemas';
import { OWN_DOCUMENTS_ONLY, type Visibility } from '@/lib/visibility';

/**
 * Gegen eine echte Datenbank (ADR 0020). Laeuft nur, wenn
 * `KNOWLEDGE_TEST_DATABASE_URL` und `KNOWLEDGE_TEST_DATABASE_SCHEMA` gesetzt
 * sind — sonst uebersprungen, nicht gescheitert. Die Verbindung muss die
 * App-Rolle sein (kein Owner, kein Superuser), mit einem eigenen, leeren
 * Schema, das ihr gehoert.
 *
 *   KNOWLEDGE_TEST_DATABASE_URL=postgres://app_knowledge:…@localhost:55432/openapps_test \
 *   KNOWLEDGE_TEST_DATABASE_SCHEMA=app_knowledge pnpm --filter @openapps/app-knowledge test
 *
 * Seit 0.3.0 braucht die Migration 0004 pgvector im Schema `extensions` und
 * USAGE der Rolle darauf (siehe `embeddings.db.test.ts`).
 *
 * Riskant und deshalb zuerst: Treffer aus nicht lesbaren Apps, fremde
 * Quellen ersetzen oder entfernen, deutsche Wortformen.
 */
const url = process.env.KNOWLEDGE_TEST_DATABASE_URL ?? '';
const schema = process.env.KNOWLEDGE_TEST_DATABASE_SCHEMA ?? '';
const enabled = url !== '' && schema !== '';

const MIGRATIONS = fileURLToPath(new URL('../migrations', import.meta.url));

const retriever = createFulltextRetriever(query);
const WIKI_ONLY: Visibility = { readableApps: ['wiki'] };
const CRM_ONLY: Visibility = { readableApps: ['crm'] };

const upsert = (input: unknown, app = 'wiki') =>
  upsertSourceDocument(UpsertArgs.parse(input), app, `app:${app}`);

describe.skipIf(!enabled)('Knowledge against Postgres', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.DATABASE_SCHEMA = schema;
    process.env.OPENAPPS_APP_HOST = 'apps.example.test';
    await runMigrations(appPool(), MIGRATIONS);
  });

  beforeEach(async () => {
    await query('delete from documents');
  });

  afterAll(async () => {
    await appPool().end();
  });

  it('findet deutsche Wortformen, die das englische Woerterbuch nicht kennt', async () => {
    await addDocument(
      DocumentInput.parse({
        title: 'Reiserichtlinie',
        content: 'Die Reisekosten werden innerhalb von vierzehn Tagen erstattet.',
      }),
      'usr_test',
    );
    const passages = await retriever.search('Reisekosten erstatten', 5, OWN_DOCUMENTS_ONLY);
    expect(passages).toHaveLength(1);
    expect(passages[0]?.excerpt).toContain('«');
    // Plural und Flexion: „Tag“ findet „Tagen“.
    expect(await retriever.search('Tag', 5, OWN_DOCUMENTS_ONLY)).toHaveLength(1);
  });

  it('findet englische Wortformen weiterhin', async () => {
    await addDocument(
      DocumentInput.parse({ title: 'Travel', content: 'All trips need approval.' }),
      'usr_test',
    );
    expect(await retriever.search('trip', 5, OWN_DOCUMENTS_ONLY)).toHaveLength(1);
  });

  it('zeigt keine Treffer aus einer App, die nicht in der Liste steht', async () => {
    await upsert({ key: 'p1', title: 'Geheimes Onboarding', content: 'Onboarding im Wiki' });
    expect(await retriever.search('Onboarding', 5, OWN_DOCUMENTS_ONLY)).toEqual([]);
    expect(await retriever.search('Onboarding', 5, { readableApps: [] })).toEqual([]);
    expect(await retriever.search('Onboarding', 5, CRM_ONLY)).toEqual([]);
    const hits = await retriever.search('Onboarding', 5, WIKI_ONLY);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      sourceApp: 'wiki',
      sourcePath: null,
      sourceUrl: 'https://apps.example.test/wiki',
    });
  });

  it('auch die ODER-Stufe zeigt nichts aus nicht lesbaren Apps', async () => {
    await upsert({ key: 'p1', title: 'Wiki', content: 'Onboarding Checkliste' });
    // Zwei Woerter, eines kommt nicht vor: streng leer, die ODER-Stufe greift.
    expect(await retriever.search('Onboarding Raumschiff', 5, OWN_DOCUMENTS_ONLY)).toEqual([]);
    expect(await retriever.search('Onboarding Raumschiff', 5, WIKI_ONLY)).toHaveLength(1);
  });

  it('documents.list und documents.get folgen derselben Sichtbarkeit', async () => {
    const own = await addDocument(
      DocumentInput.parse({ title: 'Eigenes', content: 'Text' }),
      'usr_test',
    );
    const wiki = await upsert({ key: 'p1', title: 'Seite', content: 'Text', path: '/pages/p1' });
    expect((await listDocuments({}, OWN_DOCUMENTS_ONLY)).map((d) => d.id)).toEqual([own.id]);
    expect((await listDocuments({}, WIKI_ONLY)).map((d) => d.id).sort()).toEqual(
      [own.id, wiki.id].sort(),
    );
    await expect(getDocument({ id: wiki.id, includeChunks: false }, CRM_ONLY)).rejects.toBeInstanceOf(
      ToolNotFoundError,
    );
    const visible = await getDocument({ id: wiki.id, includeChunks: false }, WIKI_ONLY);
    expect(visible.document).toMatchObject({
      sourceApp: 'wiki',
      sourceKey: 'p1',
      sourcePath: '/pages/p1',
      sourceUrl: 'https://apps.example.test/wiki/pages/p1',
    });
  });

  it('ersetzt anhand der Quelle, Abschnitte inklusive', async () => {
    const first = await upsert({ key: 'p1', title: 'Alt', content: 'Alter Inhalt ueber Urlaub' });
    expect(first.status).toBe('created');
    const second = await upsert({ key: 'p1', title: 'Neu', content: 'Neuer Inhalt ueber Gehalt' });
    expect(second.status).toBe('updated');
    expect(second.id).toBe(first.id);
    expect(await retriever.search('Urlaub', 5, WIKI_ONLY)).toEqual([]);
    expect(await retriever.search('Gehalt', 5, WIKI_ONLY)).toHaveLength(1);
    const rows = await query<{ n: number }>('select count(*)::int as n from documents');
    expect(rows[0]?.n).toBe(1);
  });

  it('ein aelterer Stand ueberschreibt keinen neueren', async () => {
    await upsert({ key: 'p1', title: 'Neu', content: 'Stand B', updatedAt: '2026-11-27T10:00:00Z' });
    const stale = await upsert({
      key: 'p1',
      title: 'Alt',
      content: 'Stand A',
      updatedAt: '2026-11-27T09:00:00Z',
    });
    expect(stale.status).toBe('stale');
    const { document } = await getDocument({ id: stale.id, includeChunks: false }, WIKI_ONLY);
    expect(document.title).toBe('Neu');
  });

  it('eine App kann fremde Quellen weder ersetzen noch entfernen', async () => {
    const wiki = await upsert({ key: 'p1', title: 'Wiki-Seite', content: 'Inhalt des Wikis' });
    // crm schickt denselben Schluessel: trifft nur ein eigenes Dokument.
    const crm = await upsert({ key: 'p1', title: 'CRM', content: 'Inhalt des CRM' }, 'crm');
    expect(crm.id).not.toBe(wiki.id);
    expect(crm.status).toBe('created');
    expect(await removeSourceDocument({ key: 'p1' }, 'tasks')).toEqual({
      key: 'p1',
      removed: false,
    });
    const { document } = await getDocument({ id: wiki.id, includeChunks: false }, WIKI_ONLY);
    expect(document.title).toBe('Wiki-Seite');
    // Die eigene entfernt sie, idempotent.
    expect(await removeSourceDocument({ key: 'p1' }, 'crm')).toEqual({ key: 'p1', removed: true });
    expect(await removeSourceDocument({ key: 'p1' }, 'crm')).toEqual({ key: 'p1', removed: false });
    expect((await listDocuments({}, WIKI_ONLY)).map((d) => d.id)).toEqual([wiki.id]);
  });

  it('documents.delete loescht kein Dokument einer Quell-App', async () => {
    const wiki = await upsert({ key: 'p1', title: 'Seite', content: 'Text' });
    await expect(deleteDocument(wiki.id)).rejects.toBeInstanceOf(ToolInputError);
    expect(await listDocuments({}, WIKI_ONLY)).toHaveLength(1);
  });

  it('die Datenbank lehnt einen Pfad ab, der aus der Quell-App herausfuehrt', async () => {
    await expect(
      query(
        `insert into documents (title, content, char_count, created_by, source_app, source_key, source_path)
         values ('t', 'c', 1, 'x', 'wiki', 'k', '//evil.example')`,
      ),
    ).rejects.toThrow();
    await expect(
      query(
        `insert into documents (title, content, char_count, created_by, source_app, source_key, source_path)
         values ('t', 'c', 1, 'x', 'wiki', 'k', '/../grants')`,
      ),
    ).rejects.toThrow();
    // Quell-App ohne Schluessel ist kein Paar.
    await expect(
      query(
        `insert into documents (title, content, char_count, created_by, source_app)
         values ('t', 'c', 1, 'x', 'wiki')`,
      ),
    ).rejects.toThrow();
  });
});
