/**
 * Die Suche ueber alle Apps am laufenden Stapel (ADR 0021): die Leiste und
 * das MCP-Tool `search` fragen die Such-Tools der Apps parallel ab.
 *
 * Geprueft wird zuerst, was fehlen muss:
 *
 * - Ein Agent bekommt eine App nur mit `read` auf die App UND `execute` auf
 *   ihr Such-Tool.
 * - Ohne Session antwortet `/_platform/search` auf dem Host der Apps mit
 *   401, auch mit gefaelschten `X-Auth-*`; andere Pfade unter `/_platform/`
 *   mit 403.
 * - Eine Person ohne Freigabe bekommt keine Treffer; mit `read` auf das CRM
 *   nur die des CRM.
 *
 * Dann der Weg in der Leiste: Ansehen-Proxy auf 8090, ⌘K, Treffer nach App
 * gruppiert, Klick oeffnet den Treffer.
 *
 * Voraussetzung: CRM und Tasks 0.3.0, Wiki 0.3.2 und Knowledge 0.2.2 sind
 * ausgerollt. Sonst wird uebersprungen, nicht gescheitert.
 *
 * Jede Freigabe und den Agenten, die dieser Test anlegt, nimmt er am Ende
 * zurueck. Die Testdaten bleiben, mit der Kennung des Laufs im Namen: Die
 * Firma im CRM (es gibt kein Loeschen), die Aufgabe als erledigt, die
 * Wiki-Seite archiviert, das Dokument in Knowledge geloescht.
 */

import { expect, test } from '@playwright/test';
import { forgedIdentityHeaders, gatewayGet } from '../src/gateway';
import { OperatorMcp, type ListedApp, type ToolResult } from '../src/mcp';
import { mintUserSession, type MintedSession } from '../src/session';
import { APPS_HOST, roleEmails, VIEW_URL } from '../src/stack';

test.describe.configure({ mode: 'serial' });

const NONCE = `e2e${Date.now().toString(36)}`;
const TITLE = `Search ${NONCE}`;

interface SearchHit {
  readonly id: string;
  readonly title: string;
  readonly href: string;
  readonly kind?: string;
}

interface SearchResult {
  readonly results: readonly { readonly app: string; readonly hits: readonly SearchHit[] }[];
  readonly failed: readonly { readonly app: string; readonly reason: string }[];
  readonly searched: readonly string[];
}

const REQUIRED: Readonly<Record<string, string>> = {
  crm: '0.3.0',
  tasks: '0.3.0',
  wiki: '0.3.2',
  knowledge: '0.2.2',
};

let mcp: OperatorMcp;
let agent: OperatorMcp | undefined;
let agentName: string | undefined;
let session: MintedSession | undefined;
const grants: string[] = [];
const created: {
  companyId?: string;
  taskId?: string;
  pageId?: string;
  documentId?: string;
} = {};

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

async function grant(
  subjectKind: string,
  subjectId: string,
  verb: 'read' | 'execute',
  resourceKind: 'app' | 'tool',
  resourceId: string,
): Promise<void> {
  const { grant: made } = await mcp.must<{ grant: { id: string } }>('grant', {
    subjectKind,
    subjectId,
    verb,
    resourceKind,
    resourceId,
  });
  grants.push(made.id);
}

/** Nur die Treffer dieses Laufs: Fruehere Laeufe hinterlassen gleich gebaute Daten. */
function ownHits(result: SearchResult): Record<string, SearchHit[]> {
  const byApp: Record<string, SearchHit[]> = {};
  for (const group of result.results) {
    const hits = group.hits.filter((hit) => hit.title.includes(NONCE));
    if (hits.length > 0) byApp[group.app] = hits;
  }
  return byApp;
}

async function searchAs(client: OperatorMcp): Promise<SearchResult> {
  const result: ToolResult = await client.call('search', { query: NONCE, limit: 10 });
  if (!result.ok) throw new Error(`search failed: ${result.error?.message ?? ''}`);
  return result.value as SearchResult;
}

/** Wartet, bis die Suche das Erwartete liefert. Das Wiki liefert nach dem Commit. */
async function eventually(
  read: () => Promise<SearchResult>,
  predicate: (hits: Record<string, SearchHit[]>) => boolean,
): Promise<Record<string, SearchHit[]>> {
  const deadline = Date.now() + 20_000;
  let last: Record<string, SearchHit[]> = {};
  while (Date.now() < deadline) {
    last = ownHits(await read());
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return last;
}

function cookieHeader(): Record<string, string> {
  if (session === undefined) throw new Error('no session');
  return { cookie: `${session.cookieName}=${session.cookieValue}` };
}

async function gatewaySearch(headers: Record<string, string> = {}) {
  return gatewayGet(`/_platform/search?q=${encodeURIComponent(NONCE)}&limit=10`, headers);
}

async function viewSearch(): Promise<SearchResult> {
  const response = await fetch(
    `${VIEW_URL}/_platform/search?q=${encodeURIComponent(NONCE)}&limit=10`,
  );
  if (!response.ok) throw new Error(`view proxy search answered ${String(response.status)}`);
  return (await response.json()) as SearchResult;
}

test.beforeAll(async () => {
  mcp = await OperatorMcp.connect();
  const apps = await mcp.deployedApps();
  const missing = Object.entries(REQUIRED)
    .filter(([name, minimum]) => !atLeast(versionOf(apps, name), minimum))
    .map(([name, minimum]) => `${name} >= ${minimum} (found ${String(versionOf(apps, name))})`);
  test.skip(missing.length > 0, `needs ${missing.join(', ')}`);
  // Eine Control Plane ohne die Suche kennt das Tool nicht.
  const probe = await mcp.call('search', { query: 'probe' });
  test.skip(
    !probe.ok && probe.error?.code === 'mcp_error',
    'the control plane has no platform search yet; rebuild it',
  );

  // operator darf freigeben, ruft App-Tools aber nur mit eigener Freigabe.
  for (const tool of [
    'crm.companies.create',
    'tasks.tasks.create',
    'tasks.tasks.complete',
    'wiki.pages.create',
    'wiki.pages.archive',
    'knowledge.documents.add',
    'knowledge.documents.delete',
  ]) {
    await grant('agent', 'operator', 'execute', 'tool', tool);
  }

  const company = await mcp.must<{ company: { id: string } }>('crm__companies__create', {
    args: { name: TITLE },
  });
  created.companyId = company.company.id;
  const task = await mcp.must<{ task: { id: string } }>('tasks__tasks__create', {
    args: { title: TITLE },
  });
  created.taskId = task.task.id;
  const page = await mcp.must<{ id: string }>('wiki__pages__create', {
    args: { title: TITLE, contentMd: `Created by the platform search test ${NONCE}.` },
  });
  created.pageId = page.id;
  const document = await mcp.must<{ id: string }>('knowledge__documents__add', {
    args: { title: TITLE, content: `Knowledge document of the platform search test ${NONCE}.` },
  });
  created.documentId = document.id;
});

test.afterAll(async () => {
  if (created.taskId !== undefined) {
    await mcp?.call('tasks__tasks__complete', { args: { id: created.taskId } });
  }
  if (created.pageId !== undefined) {
    await mcp?.call('wiki__pages__archive', { args: { id: created.pageId } });
  }
  if (created.documentId !== undefined) {
    await mcp?.call('knowledge__documents__delete', { args: { id: created.documentId } });
  }
  for (const id of grants.reverse()) {
    await mcp?.call('revoke', { grantId: id });
  }
  if (agentName !== undefined) await mcp?.call('disable_agent', { name: agentName });
  await agent?.close();
  await mcp?.close();
});

test('an agent gets an app only with read on the app and execute on its search tool', async () => {
  agentName = `e2e-find-${NONCE}`.slice(0, 60);
  const made = await mcp.must<{ token: string }>('create_agent', { name: agentName });
  agent = await OperatorMcp.connectWithToken(made.token);

  // Ohne Freigabe: keine App gefragt.
  const nothing = await searchAs(agent);
  expect(nothing.searched).toEqual([]);
  expect(ownHits(nothing)).toEqual({});

  // Nur execute auf das Such-Tool: immer noch nichts.
  await grant('agent', agentName, 'execute', 'tool', 'crm.search');
  expect(ownHits(await searchAs(agent))).toEqual({});

  // Nur read auf eine andere App: deren Such-Tool ist nicht freigegeben.
  await grant('agent', agentName, 'read', 'app', 'tasks');
  expect((await searchAs(agent)).searched).not.toContain('tasks');

  // Beides fuer das CRM: genau das CRM.
  await grant('agent', agentName, 'read', 'app', 'crm');
  const result = await searchAs(agent);
  expect(result.searched).toEqual(['crm']);
  const hits = ownHits(result);
  expect(Object.keys(hits)).toEqual(['crm']);
  expect(hits.crm?.[0]?.href).toContain(`/crm/companies/${String(created.companyId)}`);
});

test('without a session /_platform/search is 401, also with forged identity headers', async () => {
  const plain = await gatewaySearch();
  expect(plain.status).toBe(401);
  expect(plain.location).toBeNull();

  const forged = await gatewaySearch(forgedIdentityHeaders(roleEmails().admin));
  expect(forged.status).toBe(401);
  expect(forged.body).not.toContain(NONCE);
});

test('other paths under /_platform/ stay closed, also with a session', async () => {
  session = await mintUserSession();
  expect(session.email).toBe(roleEmails().user);
  const existing = await mcp.activeGrantsOfUser(session.userId);
  expect(
    existing.map((g) => `${g.verb} ${g.resource.kind}:${g.resource.id}`),
    `${session.email} must start without grants; revoke them first`,
  ).toEqual([]);

  for (const path of ['/_platform/grants', '/_platform/search/../../api/grants', '/_platform/']) {
    const response = await gatewayGet(path, cookieHeader());
    expect(response.status, path).toBe(403);
  }
});

test('a person without grants gets no hits, with read on the CRM only the CRM', async () => {
  const none = await gatewaySearch(cookieHeader());
  expect(none.status).toBe(200);
  const empty = JSON.parse(none.body) as SearchResult;
  expect(empty.searched).toEqual([]);
  expect(ownHits(empty)).toEqual({});

  if (session === undefined) throw new Error('no session');
  grants.push(await mcp.grantAppRead(session.userId, 'crm'));
  // Gefaelschte Header neben der Session aendern nichts: Es zaehlt die Session.
  const withCrm = await gatewaySearch({
    ...cookieHeader(),
    ...forgedIdentityHeaders(roleEmails().admin),
  });
  expect(withCrm.status).toBe(200);
  const result = JSON.parse(withCrm.body) as SearchResult;
  expect(result.searched).toEqual(['crm']);
  const hits = ownHits(result);
  expect(Object.keys(hits)).toEqual(['crm']);
  expect(hits.crm?.[0]?.href).toBe(
    `https://${APPS_HOST}/crm/companies/${String(created.companyId)}`,
  );
});

test('in the bar, typing shows hits grouped by app and a click opens the hit', async ({ page }) => {
  // Der Ansehen-Proxy sucht als der Betrachter in allen Apps. Die Wiki-Seite
  // kommt nach dem Commit; erst warten, dann tippen.
  const hits = await eventually(viewSearch, (found) =>
    ['crm', 'tasks', 'wiki', 'knowledge'].every((app) => found[app] !== undefined),
  );
  expect(Object.keys(hits).sort()).toEqual(['crm', 'knowledge', 'tasks', 'wiki']);
  // Knowledge zeigt nur eigene Dokumente, nicht die Wiki-Seite noch einmal.
  expect(hits.knowledge?.map((hit) => hit.id)).toEqual([created.documentId]);

  await page.goto(`${VIEW_URL}/tasks`);
  await page.keyboard.press('Control+k');
  const input = page.getByRole('combobox');
  await expect(input).toBeFocused();
  await input.fill(NONCE);

  const listbox = page.getByRole('listbox');
  for (const heading of ['CRM', 'Tasks', 'Wiki', 'Knowledge']) {
    await expect(listbox.getByText(heading, { exact: true }).first()).toBeVisible();
  }
  await expect(listbox.getByRole('option').filter({ hasText: TITLE })).toHaveCount(4);

  const crmOption = listbox
    .getByRole('option')
    .filter({ hasText: TITLE })
    .filter({ hasText: 'company' });
  await crmOption.click();
  await expect(page).toHaveURL(`${VIEW_URL}/crm/companies/${String(created.companyId)}`);
});
