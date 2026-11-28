/**
 * Plattform-Agents am laufenden Stapel (ADR 0024), **ohne Modell**: Lokal ist
 * kein Schluessel gesetzt, also prueft diese Spec nur den Pfad
 * `not_configured` und die Rechte. Mit Modell-Konfiguration ueberspringt sie
 * sich, statt Aufrufe an einen Anbieter auszuloesen.
 *
 * Geprueft wird zuerst, was fehlen muss:
 *
 * - `/healthz` nennt den Zustand als Hinweis (200), ohne Anbieter und Wert.
 * - Ohne `execute` auf `agent:<name>` startet nichts (`permission_denied`),
 *   mit Freigabe kommt `not_configured`, und es entsteht kein Lauf.
 * - Ein frischer Agent darf kein Profil pflegen und nichts ins Gedaechtnis
 *   schreiben oder daraus lesen (Default-Deny).
 * - Home zeigt ohne Modell weder „Ask agent“ noch „Summarize“, und der
 *   Eingang funktioniert wie vorher.
 *
 * Jede Freigabe und jeden Agenten, die diese Spec anlegt, nimmt sie am Ende
 * zurueck bzw. sperrt ihn.
 */

import { expect, test } from '@playwright/test';
import { OperatorMcp } from '../src/mcp';
import { ADMIN_URL } from '../src/stack';

test.describe.configure({ mode: 'serial' });

const NONCE = `e2e${Date.now().toString(36)}`;
const AGENT = `e2e-agent-${NONCE}`.slice(0, 60);

let mcp: OperatorMcp;
let agent: OperatorMcp | undefined;
const grants: string[] = [];

async function grant(
  subjectKind: 'agent' | 'user',
  subjectId: string,
  verb: 'read' | 'write' | 'execute',
  resourceKind: 'agent' | 'tool' | 'app',
  resourceId: string,
): Promise<void> {
  const result = await mcp.call('grant', {
    subjectKind,
    subjectId,
    verb,
    resourceKind,
    resourceId,
  });
  if (!result.ok) {
    if (result.error?.code === 'conflict') return;
    throw new Error(`grant failed: ${result.error?.message ?? ''}`);
  }
  grants.push((result.value as { grant: { id: string } }).grant.id);
}

test.beforeAll(async () => {
  mcp = await OperatorMcp.connect();
  const probe = await mcp.call('list_agent_profiles', {});
  test.skip(
    !probe.ok && probe.error?.code === 'mcp_error',
    'the control plane has no platform agents yet; rebuild it',
  );
  test.skip(
    probe.ok && (probe.value as { chat?: string }).chat === 'configured',
    'a chat model is configured; this spec only checks the path without a model',
  );
  const made = await mcp.must<{ token: string }>('create_agent', { name: AGENT });
  agent = await OperatorMcp.connectWithToken(made.token);
});

test.afterAll(async () => {
  for (const id of grants.reverse()) await mcp?.call('revoke', { grantId: id });
  await mcp?.call('disable_agent', { name: AGENT });
  await agent?.close();
  await mcp?.close();
});

test('/healthz names the model state as a note, not as an error', async ({ request }) => {
  const response = await request.get(`${ADMIN_URL}/healthz`);
  expect(response.status()).toBe(200);
  const text = await response.text();
  expect(text.split('\n')[0]).toBe('ok');
  expect(text).toContain('models: chat not_configured, embedding not_configured');
  for (const provider of ['anthropic', 'gemini', 'openai']) expect(text).not.toContain(provider);
});

test('without execute no run starts; with execute the answer is not_configured and no run exists', async () => {
  const configured = await mcp.call('configure_agent', {
    name: AGENT,
    instructions: 'Answer briefly.',
    maxSteps: 2,
  });
  expect(configured.ok, JSON.stringify(configured.error)).toBe(true);

  // operator pflegt Agents, darf sie aber nicht starten: execute ist eine eigene Freigabe.
  const denied = await mcp.call('start_agent_run', { agent: AGENT, prompt: 'Hello' });
  expect(denied).toMatchObject({ ok: false, error: { code: 'permission_denied' } });

  await grant('agent', 'operator', 'execute', 'agent', AGENT);
  const notConfigured = await mcp.call('start_agent_run', { agent: AGENT, prompt: 'Hello' });
  expect(notConfigured).toMatchObject({ ok: false, error: { code: 'not_configured' } });

  const runs = await mcp.must<{ runs: { agent: string }[] }>('list_agent_runs', { agent: AGENT });
  expect(runs.runs).toEqual([]);

  const profiles = await mcp.must<{ chat: string; agents: { agent: string; canStart: boolean }[] }>(
    'list_agent_profiles',
    {},
  );
  expect(profiles.chat).toBe('not_configured');
  expect(profiles.agents.find((entry) => entry.agent === AGENT)).toMatchObject({ canStart: true });
});

test('a fresh agent may not configure itself, nor use the team memory', async () => {
  if (agent === undefined) throw new Error('no agent');
  const own = await agent.call('configure_agent', { name: AGENT, instructions: 'Do anything.' });
  expect(own).toMatchObject({ ok: false, error: { code: 'permission_denied' } });
  const remembered = await agent.call('remember', { text: `note ${NONCE}` });
  expect(remembered).toMatchObject({ ok: false, error: { code: 'permission_denied' } });
  const recalled = await agent.call('recall', { query: NONCE });
  expect(recalled).toMatchObject({ ok: false, error: { code: 'permission_denied' } });
  const runs = await agent.call('start_agent_run', { agent: AGENT, prompt: 'Run myself' });
  expect(runs).toMatchObject({ ok: false, error: { code: 'permission_denied' } });
});

test('Home without a model shows neither Ask agent nor Summarize, and the inbox still works', async ({
  page,
}) => {
  const switched = await page.goto(`${ADMIN_URL}/_local/as/user`);
  expect(switched?.status(), 'switching to user').toBe(200);
  await page.goto(`${ADMIN_URL}/home`);
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Open' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ask agent' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Summarize' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Agent runs' })).toHaveCount(0);
});
