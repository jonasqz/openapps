/**
 * Die gemeinsame Suche am laufenden Stapel (ADR 0020): Das Wiki liefert eine
 * Seite an Knowledge, und Knowledge zeigt sie nur, wer das Wiki lesen darf.
 *
 * Der Weg ist echt: Wiki-Tool ueber den Plattform-MCP, Outbox nach dem
 * Commit, `callAppTool` des Wikis ueber die Control Plane mit Freigabe fuer
 * `app:wiki`, Knowledge mit dem signierten Header der lesbaren Apps.
 *
 * Voraussetzung: Wiki 0.3.0 und Knowledge 0.2.0 sind ausgerollt, und
 * `lokal-einrichten` hat `app:wiki` die beantragten Freigaben erteilt. Sonst
 * wird uebersprungen, nicht gescheitert.
 *
 * Jede Freigabe und den Agenten, die dieser Test anlegt, nimmt er am Ende
 * zurueck. Die Testseite bleibt archiviert im Wiki (es gibt kein Loeschen).
 */

import { expect, test } from '@playwright/test';
import { OperatorMcp, type ListedApp, type ToolResult } from '../src/mcp';

test.describe.configure({ mode: 'serial' });

const NONCE = `e2e${Date.now().toString(36)}`;
/** Deutsche Wortform, die das englische Woerterbuch nicht findet. */
const CONTENT = `Die Reisekosten ${NONCE} werden nach der Abrechnung erstattet.`;
const QUERY = `erstatten ${NONCE}`;

let mcp: OperatorMcp;
let reader: OperatorMcp | undefined;
const grants: string[] = [];
let agentName: string | undefined;
let pageId: string | undefined;

interface Passage {
  readonly documentTitle: string;
  readonly sourceApp: string | null;
  readonly sourceUrl: string | null;
}

function versionOf(apps: readonly ListedApp[], name: string): string | undefined {
  return apps.find((app) => app.name === name)?.manifest.version;
}

/** Mindestens `minimum`? Semver ohne Vorabversion, Teil fuer Teil als Zahl. */
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
  const { grant } = await mcp.must<{ grant: { id: string } }>('grant', {
    subjectKind,
    subjectId,
    verb: 'execute',
    resourceKind: 'tool',
    resourceId: tool,
  });
  grants.push(grant.id);
}

async function search(client: OperatorMcp): Promise<readonly Passage[]> {
  const result: ToolResult = await client.call('knowledge__search', { args: { query: QUERY } });
  if (!result.ok) throw new Error(`search failed: ${result.error?.message ?? ''}`);
  // Nur die Seite dieses Laufs: Ein frueher abgebrochener Lauf kann eine
  // gleichlautende Seite im Wiki hinterlassen haben.
  return (result.value as { passages: Passage[] }).passages.filter(
    (p) => p.sourceApp !== 'wiki' || p.documentTitle.includes(NONCE),
  );
}

/** Wartet, bis die Suche das Erwartete liefert. Die Lieferung laeuft nach dem Commit. */
async function eventually(
  client: OperatorMcp,
  predicate: (passages: readonly Passage[]) => boolean,
): Promise<readonly Passage[]> {
  const deadline = Date.now() + 30_000;
  let last: readonly Passage[] = [];
  while (Date.now() < deadline) {
    last = await search(client);
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return last;
}

test.beforeAll(async () => {
  mcp = await OperatorMcp.connect();
  const apps = await mcp.deployedApps();
  const wiki = versionOf(apps, 'wiki');
  const knowledge = versionOf(apps, 'knowledge');
  test.skip(
    !atLeast(wiki, '0.3.0') || !atLeast(knowledge, '0.2.0'),
    `needs wiki >= 0.3.0 and knowledge >= 0.2.0 (found ${String(wiki)}, ${String(knowledge)})`,
  );
  // operator darf alles freigeben, ruft App-Tools aber nur mit eigener Freigabe.
  for (const tool of ['wiki.pages.create', 'wiki.pages.archive', 'knowledge.search']) {
    await grantTool('agent', 'operator', tool);
  }
});

test.afterAll(async () => {
  // Scheitert ein Test vor dem Archivieren, bleibt die Seite sonst liegen.
  if (pageId !== undefined) await mcp?.call('wiki__pages__archive', { args: { id: pageId } });
  for (const id of grants.reverse()) {
    await mcp.call('revoke', { grantId: id });
  }
  if (agentName !== undefined) await mcp.call('disable_agent', { name: agentName });
  await reader?.close();
  await mcp?.close();
});

test('a new wiki page shows up in Knowledge, found by a German word form', async () => {
  const page = await mcp.must<{ id: string }>('wiki__pages__create', {
    args: { title: `Travel ${NONCE}`, contentMd: CONTENT },
  });
  pageId = page.id;
  // operator hat read auf app:*, also auch auf das Wiki.
  const passages = await eventually(mcp, (p) => p.some((hit) => hit.sourceApp === 'wiki'));
  const hit = passages.find((p) => p.sourceApp === 'wiki');
  expect(hit?.documentTitle).toBe(`Travel ${NONCE}`);
  expect(hit?.sourceUrl).toContain(`/wiki/pages/${page.id}`);
});

test('an agent without read on the wiki does not see the page', async () => {
  agentName = `e2e-search-${NONCE}`.slice(0, 60);
  const created = await mcp.must<{ token: string }>('create_agent', { name: agentName });
  await grantTool('agent', agentName, 'knowledge.search');
  reader = await OperatorMcp.connectWithToken(created.token);

  expect((await search(reader)).filter((p) => p.sourceApp === 'wiki')).toEqual([]);

  const { grant } = await mcp.must<{ grant: { id: string } }>('grant', {
    subjectKind: 'agent',
    subjectId: agentName,
    verb: 'read',
    resourceKind: 'app',
    resourceId: 'wiki',
  });
  grants.push(grant.id);
  const passages = await eventually(reader, (p) => p.some((hit) => hit.sourceApp === 'wiki'));
  expect(passages.some((p) => p.sourceApp === 'wiki')).toBe(true);
});

test('archiving the page removes it from Knowledge', async () => {
  expect(pageId).toBeDefined();
  await mcp.must('wiki__pages__archive', { args: { id: pageId } });
  const passages = await eventually(mcp, (p) => !p.some((hit) => hit.sourceApp === 'wiki'));
  expect(passages.filter((p) => p.sourceApp === 'wiki')).toEqual([]);
});
