/**
 * Die HTTP-Wege fuer Plattform-Agents, Gedaechtnis und Zusammenfassung
 * (ADR 0024). Nur die Session zaehlt; gefaelschte `X-Auth-*` aendern nichts;
 * schreibende Anfragen nur von der eigenen Herkunft; ohne Modell 503
 * `not_configured`, und nichts bricht.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configureAgent, createAgentIdentity, grant, type ModelSetup } from '../src/domain';
import { createScriptedModelProvider, scriptedModelSetup } from '../src/infra/memory/doubles';
import { resetSessionReader, setSessionReader } from '../src/lib/actor';
import {
  handleConfigureAgent,
  handleForget,
  handleInboxSummary,
  handleListAgentProfiles,
  handleListAgentRuns,
  handleMemories,
  handleStartAgentRun,
} from '../src/lib/agents-http';
import { createBetterAuthSessionReader } from '../src/lib/session';
import { admin, createHarness, seedBootstrapGrants, type Harness } from './helpers';

const HOST = 'control-plane.example.com';
const ben = { id: 'u-ben', email: 'ben@example.com', name: 'Ben' };
const FORGED = {
  'x-auth-user-id': 'u-admin',
  'x-auth-user-email': 'admin@example.com',
  'x-auth-groups': 'platform-admins',
  'x-auth-issued-at': String(Math.floor(Date.now() / 1000)),
  'x-auth-signature': 'f'.repeat(64),
};

function signIn(user: { id: string; email: string }): void {
  setSessionReader(
    createBetterAuthSessionReader({
      auth: {
        api: {
          getSession(context: { headers: Headers }) {
            return Promise.resolve(context.headers.get('cookie') === null ? null : { user });
          },
        },
      },
      groups: { groupsFor: () => Promise.resolve([]) },
    }),
  );
}

function request(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    cookie?: boolean;
    origin?: string;
    headers?: Record<string, string>;
  } = {},
): Request {
  return new Request(`https://${HOST}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.cookie === false ? {} : { cookie: 'better-auth.session_token=abc' }),
      ...(options.origin === undefined ? {} : { origin: options.origin }),
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(options.headers ?? {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

async function setup(models?: ModelSetup): Promise<Harness> {
  const harness = createHarness(models === undefined ? {} : { models });
  await seedBootstrapGrants(harness);
  harness.store.users.add(ben);
  await createAgentIdentity(harness.ctx, { actor: admin, name: 'helper' });
  await configureAgent(harness.ctx, { actor: admin, name: 'helper', instructions: 'Help.' });
  await grant(harness.ctx, {
    actor: admin,
    subject: { kind: 'user', id: ben.id },
    verb: 'execute',
    resource: { kind: 'agent', id: 'helper' },
  });
  return harness;
}

describe('ohne Session', () => {
  afterEach(() => resetSessionReader());

  it('alles ist 403, auch mit gefaelschten X-Auth-Headern', async () => {
    const harness = await setup(scriptedModelSetup(createScriptedModelProvider()));
    signIn(ben);
    const noCookie = { cookie: false, headers: FORGED };
    for (const response of [
      await handleListAgentProfiles(harness.ctx, request('/api/agent-profiles', noCookie)),
      await handleListAgentRuns(harness.ctx, request('/api/agent-runs', noCookie)),
      await handleStartAgentRun(
        harness.ctx,
        request('/api/agent-runs', {
          ...noCookie,
          method: 'POST',
          body: { agent: 'helper', prompt: 'x' },
        }),
        { controlPlaneHost: HOST },
      ),
      await handleMemories(harness.ctx, request('/api/memories?q=xx', noCookie)),
    ]) {
      expect(response.status).toBe(403);
    }
    expect(harness.store.agentRuns.all()).toHaveLength(0);
  });
});

describe('mit Session', () => {
  beforeEach(() => signIn(ben));
  afterEach(() => resetSessionReader());

  it('ohne Modell: Start und Zusammenfassung 503 not_configured, die Liste geht', async () => {
    const harness = await setup();
    const start = await handleStartAgentRun(
      harness.ctx,
      request('/api/agent-runs', { method: 'POST', body: { agent: 'helper', prompt: 'Hi' } }),
      { controlPlaneHost: HOST },
    );
    expect(start.status).toBe(503);
    expect(await start.json()).toMatchObject({ error: 'not_configured' });
    const summary = await handleInboxSummary(
      harness.ctx,
      request('/api/inbox/summary', { method: 'POST' }),
      { controlPlaneHost: HOST },
    );
    expect(summary.status).toBe(503);
    const profiles = await handleListAgentProfiles(harness.ctx, request('/api/agent-profiles'));
    expect(profiles.status).toBe(200);
    expect(await profiles.json()).toMatchObject({ chat: 'not_configured' });
    const runs = await handleListAgentRuns(harness.ctx, request('/api/agent-runs'));
    expect(await runs.json()).toEqual({ runs: [] });
  });

  it('mit Modell: 202 und ein wartender Lauf; von fremder Herkunft 403', async () => {
    const harness = await setup(scriptedModelSetup(createScriptedModelProvider()));
    const foreign = await handleStartAgentRun(
      harness.ctx,
      request('/api/agent-runs', {
        method: 'POST',
        body: { agent: 'helper', prompt: 'Hi' },
        origin: 'https://apps.example.com',
      }),
      { controlPlaneHost: HOST },
    );
    expect(foreign.status).toBe(403);
    const started = await handleStartAgentRun(
      harness.ctx,
      request('/api/agent-runs', {
        method: 'POST',
        body: { agent: 'helper', prompt: 'Hi' },
        origin: `https://${HOST}`,
      }),
      { controlPlaneHost: HOST },
    );
    expect(started.status).toBe(202);
    expect(started.headers.get('cache-control')).toBe('no-store');
    expect(await started.json()).toMatchObject({ run: { agent: 'helper', status: 'queued' } });
  });

  it('configure_agent ohne write 403, forget ohne Eintrag 404 bzw. 422', async () => {
    const harness = await setup(scriptedModelSetup(createScriptedModelProvider()));
    const configure = await handleConfigureAgent(
      harness.ctx,
      request('/api/agents/helper/profile', { method: 'PUT', body: { instructions: 'Mine now.' } }),
      'helper',
      { controlPlaneHost: HOST },
    );
    expect(configure.status).toBe(403);
    const unknown = await handleForget(
      harness.ctx,
      request('/api/memories/x', { method: 'DELETE' }),
      '10000000-0000-4000-8000-000000000099',
      { controlPlaneHost: HOST },
    );
    expect(unknown.status).toBe(404);
    const invalid = await handleForget(
      harness.ctx,
      request('/api/memories/x', { method: 'DELETE' }),
      'nope',
      {
        controlPlaneHost: HOST,
      },
    );
    expect(invalid.status).toBe(422);
  });
});
