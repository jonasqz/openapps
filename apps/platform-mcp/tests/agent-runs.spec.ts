/**
 * Laeufe der Plattform-Agents ueber den echten Plattform-MCP (ADR 0024 E):
 * Die Tools eines Laufs kommen aus `createPlatformServer`, verbunden im
 * Prozess, mit dem Kontext des Laufs.
 *
 * Die riskanten Pfade zuerst:
 *
 * - Der Lauf sieht genau die Tools, die der Agent ueber `/mcp` saehe,
 *   geschnitten mit dem Ausloeser, und keines aus `RUN_EXCLUDED_TOOLS`
 *   (`create_agent` gaebe ein Secret zurueck).
 * - Jeder Tool-Aufruf im Audit mit der Lauf-Id als `correlationId`.
 * - `remember` im Lauf nimmt die Herkunft aus dem Lauf; der Agent kann sie
 *   nicht verkleinern.
 * - Ohne Modell antworten `start_agent_run` und die Liste der Profile
 *   `not_configured`, und nichts bricht.
 */

import { describe, expect, it } from 'vitest';
import {
  claimAgentRun,
  configureAgent,
  contextForRun,
  createAgentIdentity,
  createApp,
  executeAgentRun,
  grant,
  RUN_EXCLUDED_TOOLS,
  startAgentRun,
  type Actor,
  type AppManifest,
  type DomainContext,
  type ModelSetup,
} from '@openapps/control-plane/domain';
import {
  createScriptedModelProvider,
  scriptedModelSetup,
} from '@openapps/control-plane/infra/memory/doubles';
import { createRunToolbox } from '../src/run-toolbox';
import { createRunner, runConcurrencyFrom, RUN_CONCURRENCY_DEFAULT } from '../src/runner-loop';
import { listAgentProfilesTool, platformTools, runTool, startAgentRunTool } from '../src/tools';
import {
  admin,
  createCountingInvoker,
  createHarness,
  seedBootstrapGrants,
  type Harness,
} from './helpers';

const ben: Actor = { kind: 'user', id: 'u-ben', groups: [] };
const anna: Actor = { kind: 'user', id: 'u-anna', groups: [] };
const helper: Actor = { kind: 'agent', id: 'helper' };

function app(name: string, tools: string[]): AppManifest {
  return {
    manifestVersion: 1,
    name,
    displayName: name.toUpperCase(),
    description: `Test-App ${name}`,
    category: 'test',
    version: '1.0.0',
    requiredTables: [],
    offeredTools: tools.map((tool) => ({
      name: tool,
      description: `${tool} of ${name}`,
      verb: 'read' as const,
      operationId: tool,
    })),
    requestedGrants: [],
    env: [],
    egress: [],
    source: { git: `https://example.invalid/${name}.git`, tag: 'v1.0.0' },
  };
}

async function setup(models?: ModelSetup): Promise<{ harness: Harness; ctx: DomainContext }> {
  const harness = createHarness();
  await seedBootstrapGrants(harness);
  const ctx: DomainContext = {
    ...harness.ctx,
    appsDomain: 'apps.example.com',
    ...(models === undefined ? {} : { models }),
  };
  harness.store.users.add({ id: 'u-ben', email: 'ben@example.com', name: 'Ben' });
  harness.store.users.add({ id: 'u-anna', email: 'anna@example.com', name: 'Anna' });
  await createApp(ctx, { actor: admin, name: 'crm', manifest: app('crm', ['contacts.list']) });
  await createApp(ctx, { actor: admin, name: 'wiki', manifest: app('wiki', ['pages.get']) });
  await createAgentIdentity(ctx, { actor: admin, name: 'helper' });
  await configureAgent(ctx, { actor: admin, name: 'helper', instructions: 'Help.', maxSteps: 5 });
  const give = (
    subject: Actor,
    verb: 'read' | 'write' | 'execute',
    kind: 'app' | 'tool' | 'agent',
    id: string,
  ) => grant(ctx, { actor: admin, subject, verb, resource: { kind, id } });
  await give(helper, 'read', 'app', 'crm');
  await give(helper, 'read', 'app', 'wiki');
  await give(helper, 'execute', 'tool', 'crm.contacts.list');
  await give(helper, 'execute', 'tool', 'wiki.pages.get');
  await give(helper, 'execute', 'tool', 'platform.remember');
  // Mit Admin-Rechten saehe helper ueber /mcp auch create_agent.
  await give(helper, 'write', 'agent', '*');
  await give(ben, 'read', 'app', 'crm');
  await give(ben, 'read', 'app', 'wiki');
  await give(anna, 'read', 'app', 'wiki');
  for (const user of [ben, anna]) await give(user, 'execute', 'agent', 'helper');
  return { harness, ctx };
}

async function runFor(ctx: DomainContext, by: Actor, email: string) {
  await startAgentRun(ctx, { actor: by, email, agent: 'helper', prompt: 'Do it.' });
  const run = await claimAgentRun(ctx);
  if (run === null) throw new Error('no run');
  return run;
}

describe('Tools eines Laufs', () => {
  it('genau die Tools von /mcp, geschnitten mit dem Ausloeser, ohne die ausgeschlossenen', async () => {
    const { ctx } = await setup(scriptedModelSetup(createScriptedModelProvider()));
    const invoker = createCountingInvoker();
    const benRun = await runFor(ctx, ben, 'ben@example.com');
    const toolbox = await createRunToolbox({
      ctx: contextForRun(ctx, benRun),
      scope: { runId: benRun.id, agentName: 'helper', usedApps: () => [] },
      invoker,
    });
    const names = toolbox.tools.map((tool) => tool.name);
    expect(names).toContain('crm__contacts__list');
    expect(names).toContain('wiki__pages__get');
    expect(names).toContain('search');
    for (const excluded of RUN_EXCLUDED_TOOLS) expect(names).not.toContain(excluded);
    // Die Schemas kommen ohne `$schema`, als Objekt.
    expect(toolbox.tools.every((tool) => tool.inputSchema.type === 'object')).toBe(true);
    expect(toolbox.tools.some((tool) => '$schema' in tool.inputSchema)).toBe(false);
    // Ein ausgeschlossenes Tool laeuft auch auf Zuruf nicht.
    expect(await toolbox.call('create_agent', { name: 'sneaky' })).toMatchObject({ ok: false });
    expect(await ctx.agents.findByName('sneaky')).toBeNull();
    await toolbox.close?.();

    // Anna liest das CRM nicht: keine CRM-Tools im Lauf.
    await ctx.agentRuns!.update(benRun.id, { status: 'succeeded' });
    const annaRun = await runFor(ctx, anna, 'anna@example.com');
    const annaBox = await createRunToolbox({
      ctx: contextForRun(ctx, annaRun),
      scope: { runId: annaRun.id, agentName: 'helper', usedApps: () => [] },
      invoker,
    });
    expect(annaBox.tools.map((tool) => tool.name)).not.toContain('crm__contacts__list');
    expect(await annaBox.call('crm__contacts__list', {})).toMatchObject({ ok: false });
    expect(invoker.calls).toHaveLength(0);
    await annaBox.close?.();
  });

  it('ein App-Tool laeuft ueber callAppTool als der Agent, im Audit mit der Lauf-Id, mit Herkunft', async () => {
    const { harness, ctx } = await setup(scriptedModelSetup(createScriptedModelProvider()));
    const invoker = createCountingInvoker();
    const run = await runFor(ctx, ben, 'ben@example.com');
    const toolbox = await createRunToolbox({
      ctx: contextForRun(ctx, run),
      scope: { runId: run.id, agentName: 'helper', usedApps: () => [] },
      invoker,
    });
    const outcome = await toolbox.call('crm__contacts__list', { args: { limit: 1 } });
    expect(outcome).toMatchObject({ ok: true, apps: ['crm'] });
    expect(invoker.calls).toEqual([
      { appName: 'crm', toolName: 'contacts.list', actorId: 'helper' },
    ]);
    expect(harness.store.auditEntries.at(-1)).toMatchObject({
      action: 'call_app_tool',
      actor: { kind: 'agent', id: 'helper' },
      correlationId: run.id,
      outcome: 'allowed',
    });
    // Plattform-Tools ebenso.
    await toolbox.call('list_apps', {});
    expect(harness.store.auditEntries.at(-1)).toMatchObject({
      action: 'list_apps',
      correlationId: run.id,
    });
    await toolbox.close?.();
  });
});

describe('ein ganzer Lauf ueber den Runner', () => {
  it('Modell ruft ein CRM-Tool und merkt sich etwas: Herkunft aus dem Lauf, Ergebnis im Lauf', async () => {
    const provider = createScriptedModelProvider({
      replies: [
        { toolCalls: [{ id: 'c1', name: 'crm__contacts__list', arguments: { args: {} } }] },
        {
          toolCalls: [
            { id: 'c2', name: 'remember', arguments: { text: 'Acme is a lead', apps: [] } },
          ],
        },
        { text: 'One new lead: Acme.' },
      ],
    });
    const { harness, ctx } = await setup(scriptedModelSetup(provider));
    await startAgentRun(ctx, {
      actor: ben,
      email: 'ben@example.com',
      agent: 'helper',
      prompt: 'Leads?',
    });
    const runner = createRunner({ ctx, invoker: createCountingInvoker(), concurrency: 1 });
    await runner.tick();
    await runner.stop(1000);

    const [run] = harness.store.agentRuns.all();
    expect(run).toMatchObject({ status: 'succeeded', result: 'One new lead: Acme.', steps: 3 });
    expect(run?.usedApps).toEqual(['crm']);
    const [memory] = harness.store.memories.entries();
    expect(memory).toMatchObject({ author: 'helper', apps: ['crm'], runId: run?.id });
    // Das Modell bekam die Tools des Laufs, ohne create_agent.
    expect(provider.chats[0]?.tools?.map((tool) => tool.name)).not.toContain('create_agent');
    expect(
      harness.store.auditEntries
        .filter((entry) => entry.action === 'call_app_tool' || entry.action === 'remember')
        .every((entry) => entry.correlationId === run?.id),
    ).toBe(true);
  });

  it('OPENAPPS_AGENT_RUN_CONCURRENCY: 1 bis 10, sonst der Default', () => {
    expect(runConcurrencyFrom(undefined)).toBe(RUN_CONCURRENCY_DEFAULT);
    expect(runConcurrencyFrom('4')).toBe(4);
    for (const bad of ['0', '11', 'many', '1.5']) {
      expect(runConcurrencyFrom(bad)).toBe(RUN_CONCURRENCY_DEFAULT);
    }
  });
});

describe('MCP-Tools ohne Modell', () => {
  it('stehen in platformTools; start_agent_run antwortet not_configured', async () => {
    const names = platformTools.map((tool) => tool.name);
    for (const name of [
      'configure_agent',
      'list_agent_profiles',
      'start_agent_run',
      'get_agent_run',
      'list_agent_runs',
      'remember',
      'recall',
      'list_memories',
      'forget',
    ]) {
      expect(names).toContain(name);
    }
    const { ctx } = await setup();
    const started = await runTool(
      startAgentRunTool,
      { ctx, actor: helper },
      {
        agent: 'helper',
        prompt: 'Hi',
      },
    );
    // helper darf helper nicht starten: erst die Freigabe, dann der Zustand.
    expect(started).toMatchObject({ ok: false, error: { code: 'permission_denied' } });
    await grant(ctx, {
      actor: admin,
      subject: helper,
      verb: 'execute',
      resource: { kind: 'agent', id: 'helper' },
    });
    expect(
      await runTool(startAgentRunTool, { ctx, actor: helper }, { agent: 'helper', prompt: 'Hi' }),
    ).toMatchObject({ ok: false, error: { code: 'not_configured' } });
    expect(await runTool(listAgentProfilesTool, { ctx, actor: helper }, {})).toMatchObject({
      ok: true,
      value: { chat: 'not_configured' },
    });
  });
});
