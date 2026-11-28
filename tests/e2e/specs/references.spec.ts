/**
 * Verweise zwischen Apps am laufenden Stapel (ADR 0023): aufloesen,
 * Rueckverweise, Erwaehnungen und „aus X wird Y“.
 *
 * Geprueft wird zuerst, was fehlen muss:
 *
 * - Ein Agent ohne `read` auf Tasks bekommt `restricted`, ohne Titel und ohne
 *   App-Namen; nach dem Widerruf beim naechsten Aufruf wieder (der Cache von
 *   60 s haelt nur Titel, keine Rechte).
 * - Ohne `execute` auf `tasks.tasks.create_from_ref` taucht die Aktion nicht
 *   auf.
 * - Ein erwaehnter Agent ohne `read` auf das Wiki bekommt keine Erwaehnung.
 * - `/_platform/refs/resolve` auf dem Host der Apps ist ohne Session 401,
 *   auch mit gefaelschten `X-Auth-*`.
 *
 * Dann die Wege, die gehen sollen: Ein Agent legt per MCP eine Aufgabe aus
 * einer Wiki-Seite an, die Seite zeigt den Rueckverweis `derived`; eine
 * Person (Ansehen-Proxy auf 8090) verlinkt im Wiki-Editor eine Aufgabe ueber
 * den Picker, sieht den Chip und legt aus einem Abschnitt eine Aufgabe an,
 * die sie in Tasks unter ihrer eigenen Identitaet bestaetigt.
 *
 * Voraussetzung: Tasks und Wiki 0.5.0 sind ausgerollt und die Control Plane
 * kennt `resolve_refs`. Sonst wird uebersprungen, nicht gescheitert.
 *
 * Jede Freigabe und die Agenten, die dieser Test anlegt, nimmt er am Ende
 * zurueck. Aufgaben werden erledigt, Wiki-Seiten archiviert (beide Apps
 * kennen kein Loeschen); die Kennung des Laufs steht im Titel.
 */

import { expect, test } from '@playwright/test';
import { forgedIdentityHeaders, gatewayGet } from '../src/gateway';
import { OperatorMcp, type ListedApp, type ToolResult } from '../src/mcp';
import { roleEmails, VIEW_URL, VIEWER_EMAIL } from '../src/stack';

test.describe.configure({ mode: 'serial' });

const NONCE = `e2e${Date.now().toString(36)}`;

const REQUIRED: Readonly<Record<string, string>> = { tasks: '0.5.0', wiki: '0.5.0' };

interface Resolution {
  readonly ref: string;
  readonly state: string;
  readonly title?: string;
  readonly app?: string;
  readonly appTitle?: string;
}

interface Backlink {
  readonly source: string;
  readonly kind: string;
  readonly app: string;
}

interface InboxItem {
  readonly type: string;
  readonly object: string;
}

let mcp: OperatorMcp;
const agents: { name: string; client: OperatorMcp }[] = [];
const grants: string[] = [];
const tasks: string[] = [];
const pages: string[] = [];

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

/** Erteilt und merkt sich die Freigabe; eine schon bestehende bleibt unangetastet. */
async function grant(
  subjectKind: string,
  subjectId: string,
  verb: 'read' | 'execute',
  resourceKind: 'app' | 'tool',
  resourceId: string,
): Promise<string | null> {
  const result = await mcp.call('grant', {
    subjectKind,
    subjectId,
    verb,
    resourceKind,
    resourceId,
  });
  if (!result.ok) {
    if (result.error?.code === 'conflict') return null;
    throw new Error(`grant failed: ${result.error?.message ?? ''}`);
  }
  const id = (result.value as { grant: { id: string } }).grant.id;
  grants.push(id);
  return id;
}

async function revoke(id: string | null): Promise<void> {
  if (id === null) return;
  await mcp.call('revoke', { grantId: id });
  grants.splice(grants.indexOf(id), 1);
}

async function newAgent(label: string): Promise<{ name: string; client: OperatorMcp }> {
  const name = `e2e-refs-${label}-${NONCE}`.slice(0, 60);
  const made = await mcp.must<{ token: string }>('create_agent', { name });
  const agent = { name, client: await OperatorMcp.connectWithToken(made.token) };
  agents.push(agent);
  return agent;
}

async function createTask(title: string): Promise<string> {
  const made = await mcp.must<{ task: { id: string } }>('tasks__tasks__create', {
    args: { title },
  });
  tasks.push(made.task.id);
  return made.task.id;
}

async function createPage(title: string, contentMd: string): Promise<string> {
  const made = await mcp.must<{ id: string }>('wiki__pages__create', {
    args: { title, contentMd },
  });
  pages.push(made.id);
  return made.id;
}

/** Wartet, bis `read` das Erwartete liefert: Die Apps melden nach dem Commit. */
async function eventually<T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 20_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last = await read();
  while (!predicate(last) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    last = await read();
  }
  return last;
}

async function resolveAs(client: OperatorMcp, refs: string[]): Promise<Resolution[]> {
  const result: ToolResult = await client.call('resolve_refs', { refs });
  if (!result.ok) throw new Error(`resolve_refs failed: ${result.error?.message ?? ''}`);
  return (result.value as { results: Resolution[] }).results;
}

async function backlinksAs(client: OperatorMcp, ref: string): Promise<Backlink[]> {
  const result = await client.call('list_backlinks', { ref });
  if (!result.ok) throw new Error(`list_backlinks failed: ${result.error?.message ?? ''}`);
  return (result.value as { backlinks: Backlink[] }).backlinks;
}

async function mentionsOf(client: OperatorMcp, object: string): Promise<InboxItem[]> {
  const result = await client.call('list_inbox', { state: 'all', limit: 200 });
  if (!result.ok) throw new Error(`list_inbox failed: ${result.error?.message ?? ''}`);
  return (result.value as { items: InboxItem[] }).items.filter(
    (item) => item.type === 'platform.mentioned' && item.object === object,
  );
}

test.beforeAll(async () => {
  mcp = await OperatorMcp.connect();
  const apps = await mcp.deployedApps();
  const missing = Object.entries(REQUIRED)
    .filter(([name, minimum]) => !atLeast(versionOf(apps, name), minimum))
    .map(([name, minimum]) => `${name} >= ${minimum} (found ${String(versionOf(apps, name))})`);
  test.skip(missing.length > 0, `needs ${missing.join(', ')}`);
  const probe = await mcp.call('resolve_refs', { refs: ['tasks:task:probe'] });
  test.skip(
    !probe.ok && probe.error?.code === 'mcp_error',
    'the control plane has no resolve_refs yet; rebuild it',
  );

  // operator legt Aufgaben und Seiten an; Tasks und Wiki melden Verweise
  // (lokal schon erteilt, sonst hier).
  await grant('agent', 'operator', 'execute', 'tool', 'tasks.tasks.create');
  await grant('agent', 'operator', 'execute', 'tool', 'tasks.tasks.complete');
  await grant('agent', 'operator', 'execute', 'tool', 'tasks.tasks.get');
  await grant('agent', 'operator', 'execute', 'tool', 'wiki.pages.create');
  await grant('agent', 'operator', 'execute', 'tool', 'wiki.pages.update');
  await grant('agent', 'operator', 'execute', 'tool', 'wiki.pages.archive');
  await grant('app', 'tasks', 'execute', 'tool', 'platform.set_refs');
  await grant('app', 'wiki', 'execute', 'tool', 'platform.set_refs');
});

test.afterAll(async () => {
  for (const id of tasks) await mcp?.call('tasks__tasks__complete', { args: { id } });
  for (const id of pages) await mcp?.call('wiki__pages__archive', { args: { id } });
  for (const id of [...grants].reverse()) await mcp?.call('revoke', { grantId: id });
  for (const agent of agents) {
    await mcp?.call('disable_agent', { name: agent.name });
    await agent.client.close();
  }
  await mcp?.close();
});

test('without read on Tasks a reference is restricted, without title and app name; revoked it is again', async () => {
  const taskId = await createTask(`Resolve me ${NONCE}`);
  const ref = `tasks:task:${taskId}`;
  const agent = await newAgent('resolve');

  expect(await resolveAs(agent.client, [ref])).toEqual([{ ref, state: 'restricted' }]);

  const read = await grant('agent', agent.name, 'read', 'app', 'tasks');
  // read allein reicht einem Agenten nicht: Der Resolver ist ein Tool.
  expect((await resolveAs(agent.client, [ref]))[0]?.state).toBe('restricted');
  const execute = await grant('agent', agent.name, 'execute', 'tool', 'tasks.tasks.resolve');
  const resolved = (await resolveAs(agent.client, [ref]))[0];
  expect(resolved).toMatchObject({ state: 'resolved', title: `Resolve me ${NONCE}`, app: 'tasks' });

  // Widerruf: beim naechsten Aufruf, obwohl der Titel im Cache liegt.
  await revoke(read);
  const after = (await resolveAs(agent.client, [ref]))[0];
  expect(after).toEqual({ ref, state: 'restricted' });
  expect(JSON.stringify(after)).not.toContain('Resolve me');
  await revoke(execute);
});

test('an agent creates a task from a wiki page over MCP and the page shows the derived backlink', async () => {
  const pageId = await createPage(`Source page ${NONCE}`, '## Next steps\nShip the offer.');
  const pageRef = `wiki:page:${pageId}`;
  const agent = await newAgent('derive');

  // Ohne execute keine Aktion.
  const before = await agent.client.must<{ actions: unknown[] }>('list_actions', { ref: pageRef });
  expect(before.actions).toEqual([]);
  await grant('agent', agent.name, 'execute', 'tool', 'tasks.tasks.create_from_ref');
  const after = await agent.client.must<{ actions: { tool: string }[] }>('list_actions', {
    ref: pageRef,
  });
  expect(after.actions.map((action) => action.tool)).toContain('tasks.tasks.create_from_ref');

  const made = await agent.client.must<{ task: { id: string; sourceRef: string } }>(
    'tasks__tasks__create_from_ref',
    { args: { sourceRef: pageRef, excerpt: `Ship the offer ${NONCE}` } },
  );
  tasks.push(made.task.id);
  expect(made.task.sourceRef).toBe(pageRef);

  await grant('agent', agent.name, 'read', 'app', 'wiki');
  const read = await grant('agent', agent.name, 'read', 'app', 'tasks');
  const found = await eventually(
    () => backlinksAs(agent.client, pageRef),
    (links) => links.some((link) => link.source === `tasks:task:${made.task.id}`),
  );
  expect(found).toContainEqual(
    expect.objectContaining({
      source: `tasks:task:${made.task.id}`,
      kind: 'derived',
      app: 'tasks',
    }),
  );

  // Ohne read auf Tasks (die Quell-App des Rueckverweises) ist er weg.
  await revoke(read);
  expect((await backlinksAs(agent.client, pageRef)).some((link) => link.app === 'tasks')).toBe(
    false,
  );
});

test('a mentioned agent with read on the wiki gets platform.mentioned, one without read nothing', async () => {
  const reader = await newAgent('reader');
  const outsider = await newAgent('outsider');
  await grant('agent', reader.name, 'read', 'app', 'wiki');
  const pageId = await createPage(`Mentions ${NONCE}`, 'Nothing yet.');
  const pageRef = `wiki:page:${pageId}`;
  await mcp.must('wiki__pages__update', {
    args: {
      id: pageId,
      contentMd: `Ask @{agent:${reader.name}} and @{agent:${outsider.name}}.`,
    },
  });

  const items = await eventually(
    () => mentionsOf(reader.client, pageRef),
    (found) => found.length > 0,
  );
  expect(items).toHaveLength(1);
  // Der andere darf das Wiki nicht lesen: keine Zeile, auch nicht spaeter mit Freigabe.
  await grant('agent', outsider.name, 'read', 'app', 'wiki');
  expect(await mentionsOf(outsider.client, pageRef)).toEqual([]);

  // Dieselbe Menge noch einmal (nur der Text drumherum aendert sich): keine zweite Erwaehnung.
  await mcp.must('wiki__pages__update', {
    args: {
      id: pageId,
      contentMd: `Please ask @{agent:${reader.name}} and @{agent:${outsider.name}}.`,
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 3000));
  expect(await mentionsOf(reader.client, pageRef)).toHaveLength(1);
});

test('without a session /_platform/refs/resolve is 401, also with forged identity headers', async () => {
  const path = '/_platform/refs/resolve?ref=tasks:task:1';
  expect((await gatewayGet(path)).status).toBe(401);
  const forged = await gatewayGet(path, forgedIdentityHeaders(roleEmails().admin));
  expect(forged.status).toBe(401);
  expect(forged.body).not.toContain('results');
  for (const other of [
    '/_platform/refs/backlinks?ref=tasks:task:1',
    '/_platform/people?app=wiki',
  ]) {
    expect((await gatewayGet(other)).status, other).toBe(401);
  }
  expect((await gatewayGet('/_platform/refs/other')).status).toBe(403);
});

test('a person links a task in the wiki editor, sees the chip and creates a task from a section', async ({
  page,
}) => {
  const title = `Linked task ${NONCE}`;
  await createTask(title);

  // Neue Seite im Editor, Aufgabe ueber den Picker verlinken (Suche ueber alle Apps).
  await page.goto(`${VIEW_URL}/wiki/new`);
  await page.getByLabel('Title').fill(`Editor page ${NONCE}`);
  await page.getByRole('button', { name: 'Mention or link' }).click();
  await page.getByRole('combobox', { name: 'Mention a person or link an item' }).fill(title);
  const option = page.getByRole('option').filter({ hasText: title });
  await expect(option).toBeVisible({ timeout: 15_000 });
  await option.click();
  const content = page.getByLabel('Content (Markdown)');
  await expect(content).toHaveValue(/@\{tasks:task:[0-9a-f-]{36}\}/);
  await content.press('End');
  await content.pressSequentially('\n\n## Follow up\nCall the customer back.');
  await page.getByRole('button', { name: 'Create page' }).click();
  await page.waitForURL(/\/wiki\/pages\/[0-9a-f-]{36}$/);
  pages.push(page.url().split('/').pop() ?? '');

  // Der Chip zeigt den Titel aus Tasks, nicht den Verweis.
  await expect(
    page.locator('[data-oa-ref-chip="resolved"]').filter({ hasText: title }),
  ).toBeVisible({ timeout: 15_000 });

  // Aus dem Abschnitt eine Aufgabe: Link in Tasks, dort bestaetigen.
  const section = page.locator('[data-wiki-section="Follow up"]');
  await section.getByRole('button', { name: 'Create task from section' }).click();
  await section.getByRole('link', { name: /Create task/ }).click();
  await page.waitForURL(/\/tasks\/new\?ref=wiki%3Apage%3A/);
  await expect(page.getByLabel('Title')).toHaveValue('Follow up');
  await expect(page.getByText('Created from')).toBeVisible();
  await page.getByRole('button', { name: 'Create task' }).click();
  await page.waitForURL(/\/tasks\/task\/[0-9a-f-]{36}$/);
  const taskId = page.url().split('/').pop() ?? '';
  tasks.push(taskId);

  // Unter der eigenen Identitaet der Person angelegt, mit der Quelle als Verweis.
  const detail = await mcp.must<{ task: { createdBy: string; sourceRef: string } }>(
    'tasks__tasks__get',
    { args: { id: taskId } },
  );
  expect(detail.task.createdBy).toBe(VIEWER_EMAIL);
  expect(detail.task.sourceRef).toMatch(/^wiki:page:[0-9a-f-]{36}$/);
});
