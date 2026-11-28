/**
 * Knowledge als optionales RAG am laufenden Stapel (ADR 0025), **ohne
 * Modell**: Lokal ist kein Schluessel gesetzt. Geprueft wird, dass Knowledge
 * 0.3 dann sucht wie vorher und `answer` sauber `not_configured` meldet. Ist
 * doch ein Modell konfiguriert, ueberspringt sich die Spec, statt Aufrufe an
 * einen Anbieter auszuloesen.
 *
 * Riskant zuerst:
 *
 * - `answer` ohne eigene Freigabe kommt nicht durch, auch mit Freigabe fuer
 *   `search` (Default-Deny).
 * - Ohne Modell: `embeddings.status` sagt Volltext, `search` findet ein neues
 *   Dokument ueber eine deutsche Wortform, mit derselben Form der Treffer wie
 *   in 0.2, und `answer` meldet `not_configured` mit dem Hinweis auf
 *   `search`, ohne Abschnitte.
 * - Die Suchseite zeigt die Treffer, aber keine Antwort und keinen Knopf
 *   dafuer.
 *
 * Voraussetzung: Knowledge 0.3.0 ist ausgerollt (pgvector im Schema
 * `extensions`, `apps-ausrollen.sh`). Sonst wird uebersprungen.
 *
 * Jede Freigabe, jeden Agenten und das Testdokument nimmt die Spec am Ende
 * zurueck bzw. loescht es.
 */

import { expect, test } from '@playwright/test';
import { OperatorMcp, type ListedApp } from '../src/mcp';
import { VIEW_URL } from '../src/stack';

test.describe.configure({ mode: 'serial' });

const NONCE = `e2e${Date.now().toString(36)}`;
/** Deutsche Wortform, die das englische Woerterbuch nicht findet. */
const CONTENT = `Die Fahrtkosten ${NONCE} werden nach der Abrechnung erstattet.`;
const QUERY = `erstatten ${NONCE}`;

let mcp: OperatorMcp;
let reader: OperatorMcp | undefined;
let agentName: string | undefined;
let documentId: string | undefined;
const grants: string[] = [];

/** Die Felder eines Treffers aus 0.2; 0.3 aendert nur die Reihenfolge. */
const PASSAGE_KEYS = [
  'chunkId',
  'documentId',
  'documentTitle',
  'excerpt',
  'ord',
  'score',
  'source',
  'sourceApp',
  'sourcePath',
  'sourceUrl',
  'text',
].sort();

function versionOf(apps: readonly ListedApp[], name: string): string | undefined {
  return apps.find((app) => app.name === name)?.manifest.version;
}

function atLeast(version: string | undefined, minimum: string): boolean {
  if (version === undefined) return false;
  const a = version.split(/[.-]/).map(Number);
  const b = minimum.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

async function grantTool(subjectKind: string, subjectId: string, tool: string): Promise<void> {
  const result = await mcp.call('grant', {
    subjectKind,
    subjectId,
    verb: 'execute',
    resourceKind: 'tool',
    resourceId: tool,
  });
  if (!result.ok) {
    if (result.error?.code === 'conflict') return;
    throw new Error(`grant failed: ${result.error?.message ?? ''}`);
  }
  grants.push((result.value as { grant: { id: string } }).grant.id);
}

test.beforeAll(async () => {
  mcp = await OperatorMcp.connect();
  const knowledge = versionOf(await mcp.deployedApps(), 'knowledge');
  test.skip(!atLeast(knowledge, '0.3.0'), `needs knowledge >= 0.3.0 (found ${String(knowledge)})`);
  for (const tool of [
    'knowledge.search',
    'knowledge.answer',
    'knowledge.embeddings.status',
    'knowledge.documents.add',
    'knowledge.documents.delete',
  ]) {
    await grantTool('agent', 'operator', tool);
  }
  const status = await mcp.must<{ configured: boolean }>('knowledge__embeddings__status', {
    args: {},
  });
  test.skip(
    status.configured,
    'an embedding model is configured; this spec checks the path without one',
  );
});

test.afterAll(async () => {
  if (documentId !== undefined) {
    await mcp?.call('knowledge__documents__delete', { args: { id: documentId } });
  }
  for (const id of grants.reverse()) await mcp?.call('revoke', { grantId: id });
  if (agentName !== undefined) await mcp?.call('disable_agent', { name: agentName });
  await reader?.close();
  await mcp?.close();
});

test('answer needs its own grant: a grant on search does not open it', async () => {
  agentName = `e2e-rag-${NONCE}`.slice(0, 60);
  const created = await mcp.must<{ token: string }>('create_agent', { name: agentName });
  await grantTool('agent', agentName, 'knowledge.search');
  reader = await OperatorMcp.connectWithToken(created.token);

  const denied = await reader.call('knowledge__answer', { args: { question: QUERY } });
  expect(denied.ok).toBe(false);
  // Nicht angemeldet (mcp_error) oder abgewiesen (permission_denied): beides ein Nein.
  expect(['permission_denied', 'mcp_error']).toContain(denied.error?.code);
  const allowed = await reader.call('knowledge__search', { args: { query: QUERY } });
  expect(allowed.ok).toBe(true);
});

test('without a model, embeddings.status says full text only', async () => {
  const status = await mcp.must<{
    configured: boolean;
    search: string;
    model: unknown;
    note: string;
  }>('knowledge__embeddings__status', { args: {} });
  expect(status).toMatchObject({ configured: false, search: 'fulltext', model: null });
  expect(status.note).toMatch(/full text/i);
});

test('without a model, search finds a new document as before, by a German word form', async () => {
  const created = await mcp.must<{ id: string; chunkCount: number }>('knowledge__documents__add', {
    args: { title: `Travel ${NONCE}`, content: CONTENT },
  });
  documentId = created.id;
  const { passages } = await mcp.must<{ passages: Record<string, unknown>[] }>(
    'knowledge__search',
    { args: { query: QUERY } },
  );
  const hit = passages.find((p) => p.documentId === created.id);
  expect(hit).toBeDefined();
  expect(Object.keys(hit ?? {}).sort()).toEqual(PASSAGE_KEYS);
  expect(String(hit?.excerpt)).toContain('«');
});

test('without a model, answer reports not_configured and points to search', async () => {
  const value = await mcp.must<Record<string, unknown>>('knowledge__answer', {
    args: { question: QUERY },
  });
  expect(value.status).toBe('not_configured');
  expect(String(value.message)).toMatch(/search/);
  expect(value).not.toHaveProperty('passages');
  expect(value).not.toHaveProperty('answer');
});

test('without a model, the search page shows sections but no answer', async ({ page }) => {
  await page.goto(`${VIEW_URL}/knowledge?q=${encodeURIComponent(QUERY)}`);
  await expect(page.getByRole('heading', { name: /section/ })).toBeVisible();
  await expect(page.getByText(`Travel ${NONCE}`).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Answer with sources' })).toHaveCount(0);
});
