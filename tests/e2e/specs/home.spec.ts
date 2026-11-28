/**
 * Ereignisse und Home am laufenden Stapel (ADR 0022): Tasks meldet eine
 * Zuweisung, die Control Plane leitet die Benachrichtigung ab, `list_inbox`
 * und die Seite `/home` zeigen sie.
 *
 * Geprueft wird zuerst, was fehlen muss:
 *
 * - Ein Agent ohne `read` auf Tasks bekommt keine Benachrichtigung, auch
 *   nicht nachtraeglich, wenn er die Freigabe spaeter bekommt.
 * - Nach dem Widerruf ist sie beim naechsten `list_inbox` weg.
 * - `/_platform/inbox` auf dem Host der Apps ist ohne Session 401, auch mit
 *   gefaelschten `X-Auth-*`.
 *
 * Dann Home in der Verwaltung (Ansehen-Proxy auf 8091, Rolle `user`): leerer
 * Zustand, Fehlerzustand, und die Tastenfolge `r`, `e` markiert gelesen und
 * erledigt.
 *
 * Voraussetzung: Tasks 0.4.0 ist ausgerollt und die Control Plane kennt
 * `list_inbox`. Sonst wird uebersprungen, nicht gescheitert.
 *
 * Jede Freigabe und den Agenten, die dieser Test anlegt, nimmt er am Ende
 * zurueck. Die Aufgaben bleiben, erledigt, mit der Kennung des Laufs im Titel
 * (Tasks kennt kein Loeschen).
 */

import { expect, test, type Page } from '@playwright/test';
import { forgedIdentityHeaders, gatewayGet } from '../src/gateway';
import { OperatorMcp, type ListedApp, type ToolResult } from '../src/mcp';
import { mintUserSession, type MintedSession } from '../src/session';
import { ADMIN_URL, roleEmails } from '../src/stack';

test.describe.configure({ mode: 'serial' });

const NONCE = `e2e${Date.now().toString(36)}`;

interface InboxItem {
  readonly id: string;
  readonly title: string;
  readonly state: string;
  readonly app: string;
  readonly href: string | null;
}

interface InboxResult {
  readonly items: readonly InboxItem[];
  readonly unread: number;
}

const REQUIRED: Readonly<Record<string, string>> = { tasks: '0.4.0' };

let mcp: OperatorMcp;
let agent: OperatorMcp | undefined;
let agentName: string | undefined;
let session: MintedSession | undefined;
const grants: string[] = [];
const tasks: string[] = [];

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

async function createTask(title: string, assignee: string): Promise<string> {
  const made = await mcp.must<{ task: { id: string } }>('tasks__tasks__create', {
    args: { title, assignee },
  });
  tasks.push(made.task.id);
  return made.task.id;
}

async function inboxOf(client: OperatorMcp): Promise<InboxResult> {
  const result: ToolResult = await client.call('list_inbox', { state: 'all', limit: 200 });
  if (!result.ok) throw new Error(`list_inbox failed: ${result.error?.message ?? ''}`);
  return result.value as InboxResult;
}

/** Nur die Eintraege dieses Laufs: fruehere Laeufe hinterlassen gleich gebaute. */
function own(result: InboxResult): InboxItem[] {
  return result.items.filter((item) => item.title.includes(NONCE));
}

/** Wartet, bis der Eingang das Erwartete zeigt: Tasks liefert nach dem Commit. */
async function eventually(
  read: () => Promise<InboxItem[]>,
  predicate: (items: InboxItem[]) => boolean,
  timeoutMs = 20_000,
): Promise<InboxItem[]> {
  const deadline = Date.now() + timeoutMs;
  let last: InboxItem[] = [];
  while (Date.now() < deadline) {
    last = await read();
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return last;
}

async function asUser(page: Page): Promise<void> {
  const response = await page.goto(`${ADMIN_URL}/_local/as/user`);
  expect(response?.status(), 'switching to user').toBe(200);
}

test.beforeAll(async () => {
  mcp = await OperatorMcp.connect();
  const apps = await mcp.deployedApps();
  const missing = Object.entries(REQUIRED)
    .filter(([name, minimum]) => !atLeast(versionOf(apps, name), minimum))
    .map(([name, minimum]) => `${name} >= ${minimum} (found ${String(versionOf(apps, name))})`);
  test.skip(missing.length > 0, `needs ${missing.join(', ')}`);
  const probe = await mcp.call('list_inbox', {});
  test.skip(
    !probe.ok && probe.error?.code === 'mcp_error',
    'the control plane has no inbox yet; rebuild it',
  );

  // operator legt Aufgaben an; Tasks darf melden (lokal schon erteilt, sonst hier).
  await grant('agent', 'operator', 'execute', 'tool', 'tasks.tasks.create');
  await grant('agent', 'operator', 'execute', 'tool', 'tasks.tasks.complete');
  await grant('app', 'tasks', 'execute', 'tool', 'platform.emit_event');
});

test.afterAll(async () => {
  for (const id of tasks) {
    await mcp?.call('tasks__tasks__complete', { args: { id } });
  }
  for (const id of grants.reverse()) {
    await mcp?.call('revoke', { grantId: id });
  }
  if (agentName !== undefined) await mcp?.call('disable_agent', { name: agentName });
  await agent?.close();
  await mcp?.close();
});

test('an agent without read on Tasks gets nothing, with read it gets the assignment, revoked it is gone', async () => {
  agentName = `e2e-home-${NONCE}`.slice(0, 60);
  const made = await mcp.must<{ token: string }>('create_agent', { name: agentName });
  agent = await OperatorMcp.connectWithToken(made.token);
  const address = `${agentName}@agents.invalid`;

  // Ohne Freigabe zur Zeit des Ereignisses: keine Zeile, auch nicht spaeter.
  await createTask(`Before grant ${NONCE}`, address);
  await new Promise((resolve) => setTimeout(resolve, 3000));
  expect(own(await inboxOf(agent))).toEqual([]);

  const read = await grant('agent', agentName, 'read', 'app', 'tasks');
  await createTask(`After grant ${NONCE}`, address);
  const client = agent;
  const items = await eventually(
    async () => own(await inboxOf(client)),
    (found) => found.length > 0,
  );
  expect(items.map((item) => item.title)).toEqual([`Assigned to you: After grant ${NONCE}`]);
  expect(items[0]?.app).toBe('tasks');
  expect(items[0]?.href).toMatch(/\/tasks\/task\/[0-9a-f-]{36}$/);

  // Widerruf: beim naechsten Aufruf weg.
  if (read !== null) {
    await mcp.call('revoke', { grantId: read });
    grants.splice(grants.indexOf(read), 1);
  }
  expect(own(await inboxOf(agent))).toEqual([]);
});

test('without a session /_platform/inbox is 401, also with forged identity headers', async () => {
  const plain = await gatewayGet('/_platform/inbox');
  expect(plain.status).toBe(401);
  const forged = await gatewayGet('/_platform/inbox', forgedIdentityHeaders(roleEmails().admin));
  expect(forged.status).toBe(401);
  expect(forged.body).not.toContain('items');
});

test('Home shows the empty state, then the error state', async ({ page }) => {
  session = await mintUserSession();
  expect(session.email).toBe(roleEmails().user);
  const existing = await mcp.activeGrantsOfUser(session.userId);
  expect(
    existing.map((g) => `${g.verb} ${g.resource.kind}:${g.resource.id}`),
    `${session.email} must start without grants; revoke them first`,
  ).toEqual([]);

  await asUser(page);
  await page.goto(`${ADMIN_URL}/home`);
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
  await expect(page.getByText('Nothing new')).toBeVisible();
  // Der Eintrag Home in der Leiste ist die aktuelle Seite.
  await expect(page.getByRole('link', { name: 'Home' }).first()).toHaveAttribute(
    'aria-current',
    'page',
  );

  await page.route('**/api/inbox?**', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'internal_error', message: 'unexpected error' }),
    }),
  );
  await page.getByRole('tab', { name: 'Done' }).click();
  await expect(page.getByText('The inbox could not be loaded').first()).toBeVisible();
  await page.unroute('**/api/inbox?**');
});

test('on Home the keys r and e mark an item read and done', async ({ page }) => {
  if (session === undefined) throw new Error('no session');
  await grant('user', session.userId, 'read', 'app', 'tasks');
  const title = `Triage ${NONCE}`;
  await createTask(title, session.email);

  await asUser(page);
  const row = page.getByRole('list', { name: 'Inbox' }).getByRole('listitem').filter({
    hasText: title,
  });
  await expect
    .poll(
      async () => {
        await page.goto(`${ADMIN_URL}/home`);
        return row.count();
      },
      { timeout: 20_000, intervals: [1000] },
    )
    .toBe(1);
  await expect(row).toHaveAttribute('data-state', 'unread');

  // Den Eintrag waehlen, ohne ihn zu oeffnen, dann r und e.
  await page.getByRole('heading', { name: 'Home' }).click();
  for (let step = 0; step < 200 && (await row.getAttribute('aria-current')) !== 'true'; step += 1) {
    await page.keyboard.press('j');
  }
  await expect(row).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('r');
  await expect(row).toHaveAttribute('data-state', 'read');
  await page.keyboard.press('e');
  await expect(row).toHaveCount(0);

  // Nach dem Neuladen bleibt es so: erledigt steht unter Done.
  await page.reload();
  await expect(row).toHaveCount(0);
  await page.getByRole('tab', { name: 'Done' }).click();
  await expect(
    page.getByRole('list', { name: 'Inbox' }).getByRole('listitem').filter({ hasText: title }),
  ).toHaveAttribute('data-state', 'done');
});
