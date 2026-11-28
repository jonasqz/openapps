/**
 * ADR 0024 Schritte 3 und 4: Laeufe der Plattform-Agents, Schnitt der Rechte,
 * Ausloeser.
 *
 * Die riskanten Pfade zuerst:
 *
 * - **Ein Lauf kann nichts lesen oder tun, was der Ausloeser nicht darf.**
 *   Anna ohne `read` auf dem CRM startet einen Agenten mit CRM-Freigabe: Der
 *   Lauf sieht keine CRM-Tools und wird beim Aufruf blockiert.
 * - Muster DoD 6: zwei Agents, einer mit, einer ohne Freigabe; der Ausloeser
 *   gibt keinem mehr, als er selbst hat.
 * - Ein Widerruf beim Ausloeser wirkt mitten im Lauf.
 * - Bei externem Anbieter sieht der Lauf die Tools lokaler Apps nicht.
 * - Ohne `execute` auf `agent:<name>` kein Lauf, mit Audit-Eintrag; ohne
 *   Modell `not_configured`.
 * - Eine Erwaehnung im Wiki startet genau einen Lauf; das Ergebnis steht im
 *   Eingang des Ausloesers.
 * - Jeder Tool-Aufruf steht im Audit mit der Lauf-Id.
 * - Einen Lauf sieht nur, wer alle Apps seiner Herkunft lesen darf.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  callAppTool,
  configureAgent,
  contextForRun,
  createAgentIdentity,
  createApp,
  disableAgentIdentity,
  executeAgentRun,
  claimAgentRun,
  getAgentRun,
  grant,
  listAgentProfiles,
  listAgentRuns,
  listAppTools,
  listInbox,
  NotConfiguredError,
  NotFoundError,
  PermissionDeniedError,
  revoke,
  setRefs,
  startAgentRun,
  ValidationError,
  type Actor,
  type AgentRun,
  type AppManifest,
  type AppToolInvoker,
  type ChatToolCall,
  type DomainContext,
  type Grant,
  type ModelSetup,
  type RunToolboxFactory,
} from '../src/domain';
import {
  createScriptedModelProvider,
  scriptedModelSetup,
  type ScriptedModelProvider,
} from '../src/infra/memory/doubles';
import { admin, createHarness, manifest, seedBootstrapGrants, type Harness } from './helpers';

const anna = { id: 'u-anna', email: 'anna@example.com', name: 'Anna' };
const ben = { id: 'u-ben', email: 'ben@example.com', name: 'Ben' };
const asUser = (user: { id: string }): Actor => ({ kind: 'user', id: user.id, groups: [] });
const WIKI: Actor = { kind: 'app', id: 'wiki' };
const helper: Actor = { kind: 'agent', id: 'helper' };
const plain: Actor = { kind: 'agent', id: 'plain' };

function crmManifest(): AppManifest {
  return {
    ...manifest('crm'),
    offeredTools: [
      { name: 'contacts.list', description: 'List contacts.', verb: 'read', operationId: 'list' },
      { name: 'deals.update', description: 'Update a deal.', verb: 'write', operationId: 'upd' },
    ],
  };
}

function wikiManifest(): AppManifest {
  return {
    ...manifest('wiki'),
    offeredTools: [
      { name: 'pages.get', description: 'Get a page.', verb: 'read', operationId: 'get' },
      { name: 'pages.resolve', description: 'Resolve.', verb: 'read', operationId: 'resolve' },
    ],
    objects: [{ type: 'page', description: 'A page.', resolver: 'pages.resolve' }],
  };
}

interface Fixture {
  readonly harness: Harness;
  readonly ctx: DomainContext;
  readonly invoked: { app: string; tool: string; actor: string }[];
  readonly invoker: AppToolInvoker;
  readonly grants: Record<string, Grant>;
}

async function give(
  ctx: DomainContext,
  subject: { kind: Actor['kind']; id: string },
  verb: 'read' | 'write' | 'execute',
  resource: { kind: 'app' | 'tool' | 'agent'; id: string },
): Promise<Grant> {
  return grant(ctx, { actor: admin, subject, verb, resource });
}

async function fixture(models?: ModelSetup): Promise<Fixture> {
  const harness = createHarness({
    appsDomain: 'apps.example.com',
    ...(models === undefined ? {} : { models }),
  });
  await seedBootstrapGrants(harness);
  const ctx = harness.ctx;
  harness.store.users.add(anna);
  harness.store.users.add(ben);
  await createApp(ctx, { actor: admin, name: 'crm', manifest: crmManifest() });
  await createApp(ctx, { actor: admin, name: 'wiki', manifest: wikiManifest() });
  await createAgentIdentity(ctx, { actor: admin, name: 'helper', displayName: 'Helper' });
  await createAgentIdentity(ctx, { actor: admin, name: 'plain' });
  for (const name of ['helper', 'plain']) {
    await configureAgent(ctx, {
      actor: admin,
      name,
      instructions: `You are ${name}.`,
      maxSteps: 4,
    });
  }

  const grants: Record<string, Grant> = {};
  // helper darf das CRM und das Wiki, plain nur das Wiki.
  grants.helperCrmRead = await give(ctx, helper, 'read', { kind: 'app', id: 'crm' });
  grants.helperCrmList = await give(ctx, helper, 'execute', {
    kind: 'tool',
    id: 'crm.contacts.list',
  });
  grants.helperCrmUpdate = await give(ctx, helper, 'execute', {
    kind: 'tool',
    id: 'crm.deals.update',
  });
  for (const agent of [helper, plain]) {
    await give(ctx, agent, 'read', { kind: 'app', id: 'wiki' });
    await give(ctx, agent, 'execute', { kind: 'tool', id: 'wiki.pages.get' });
  }
  // Ben darf CRM und Wiki, Anna nur das Wiki.
  grants.benCrm = await give(ctx, asUser(ben), 'read', { kind: 'app', id: 'crm' });
  await give(ctx, asUser(ben), 'read', { kind: 'app', id: 'wiki' });
  await give(ctx, asUser(anna), 'read', { kind: 'app', id: 'wiki' });
  // Beide duerfen beide Agents starten.
  for (const user of [anna, ben]) {
    for (const agent of ['helper', 'plain']) {
      await give(ctx, asUser(user), 'execute', { kind: 'agent', id: agent });
    }
  }
  await give(ctx, WIKI, 'execute', { kind: 'tool', id: 'platform.set_refs' });

  const invoked: Fixture['invoked'] = [];
  const invoker: AppToolInvoker = {
    async invoke({ app, toolName, actor }) {
      invoked.push({ app: app.name, tool: toolName, actor: `${actor.kind}:${actor.id}` });
      return { rows: [{ name: `row from ${app.name}` }] };
    },
  };
  return { harness, ctx, invoked, invoker, grants };
}

function chatSetup(
  provider: ScriptedModelProvider,
  localOnlyApps: readonly string[] = [],
): ModelSetup {
  return scriptedModelSetup(provider, { localOnlyApps });
}

/** Ein Lauf, wie die Warteschlange ihn haelt, fuer die Rechte-Tests ohne Ausfuehrung. */
async function queuedRun(
  f: Fixture,
  agent: string,
  by: { id: string; email: string },
): Promise<AgentRun> {
  const view = await startAgentRun(f.ctx, {
    actor: asUser(by),
    email: by.email,
    agent,
    prompt: 'List the newest contacts.',
  });
  const run = await f.harness.store.agentRuns.findById(view.id);
  if (run === null) throw new Error('run missing');
  return run;
}

/** Die Tools des Laufs: App-Tools ueber `callAppTool`, wie im Plattform-MCP. */
function appToolbox(f: Fixture): RunToolboxFactory {
  return async (runCtx, scope) => {
    const tools = await listAppTools(runCtx, { kind: 'agent', id: scope.agentName });
    return {
      tools: tools.map((tool) => ({
        name: tool.resourceId.replaceAll('.', '__'),
        description: tool.description ?? '',
        inputSchema: { type: 'object' },
      })),
      async call(name, args) {
        const resourceId = name.replaceAll('__', '.');
        try {
          const value = await callAppTool(runCtx, {
            actor: { kind: 'agent', id: scope.agentName },
            toolResourceId: resourceId,
            args,
            invoker: f.invoker,
            correlationId: scope.runId,
          });
          return {
            ok: true,
            content: JSON.stringify(value),
            apps: [resourceId.split('.')[0] ?? ''],
          };
        } catch (error) {
          return { ok: false, content: (error as Error).message, apps: [] };
        }
      },
    };
  };
}

const call = (name: string, args: Record<string, unknown> = {}): ChatToolCall => ({
  id: `call-${name}`,
  name,
  arguments: args,
});

describe('Schnitt der Rechte (Schritt 3)', () => {
  let f: Fixture;
  beforeEach(async () => {
    f = await fixture(chatSetup(createScriptedModelProvider()));
  });

  it('Anna ohne read auf dem CRM: der Lauf von helper sieht keine CRM-Tools und wird blockiert', async () => {
    const run = await queuedRun(f, 'helper', anna);
    const runCtx = contextForRun(f.ctx, run);
    const tools = (await listAppTools(runCtx, helper)).map((tool) => tool.resourceId);
    expect(tools).toEqual(['wiki.pages.get']);
    // Ueber /mcp saehe helper selbst beides.
    expect((await listAppTools(f.ctx, helper)).map((tool) => tool.resourceId).sort()).toEqual([
      'crm.contacts.list',
      'crm.deals.update',
      'wiki.pages.get',
    ]);
    await expect(
      callAppTool(runCtx, {
        actor: helper,
        toolResourceId: 'crm.contacts.list',
        invoker: f.invoker,
        correlationId: run.id,
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(f.invoked).toHaveLength(0);
    expect(f.harness.store.auditEntries.at(-1)).toMatchObject({
      action: 'call_app_tool',
      outcome: 'denied',
      correlationId: run.id,
    });
  });

  it('Ben mit read auf dem CRM: helper sieht die CRM-Tools, plain ohne eigene Freigabe nicht (DoD 6)', async () => {
    const helperRun = contextForRun(f.ctx, await queuedRun(f, 'helper', ben));
    const plainRun = contextForRun(f.ctx, await queuedRun(f, 'plain', ben));
    expect((await listAppTools(helperRun, helper)).map((t) => t.resourceId).sort()).toEqual([
      'crm.contacts.list',
      'crm.deals.update',
      'wiki.pages.get',
    ]);
    expect((await listAppTools(plainRun, plain)).map((t) => t.resourceId)).toEqual([
      'wiki.pages.get',
    ]);
    await expect(
      callAppTool(plainRun, {
        actor: plain,
        toolResourceId: 'crm.contacts.list',
        invoker: f.invoker,
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('ein Widerruf beim Ausloeser wirkt beim naechsten Aufruf im Lauf', async () => {
    const runCtx = contextForRun(f.ctx, await queuedRun(f, 'helper', ben));
    await callAppTool(runCtx, {
      actor: helper,
      toolResourceId: 'crm.contacts.list',
      invoker: f.invoker,
    });
    await revoke(f.ctx, { actor: admin, grantId: f.grants.benCrm!.id });
    await expect(
      callAppTool(runCtx, {
        actor: helper,
        toolResourceId: 'crm.contacts.list',
        invoker: f.invoker,
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(f.invoked).toHaveLength(1);
  });

  it('Gruppen des Ausloesers zaehlen, frisch gelesen', async () => {
    await f.ctx.groups.create({ name: 'sales', description: 'Sales' });
    await give(f.ctx, { kind: 'group', id: 'sales' }, 'read', { kind: 'app', id: 'crm' });
    const runCtx = contextForRun(f.ctx, await queuedRun(f, 'helper', anna));
    expect((await listAppTools(runCtx, helper)).map((t) => t.resourceId)).toEqual([
      'wiki.pages.get',
    ]);
    await f.ctx.groups.ensureMembership('sales', anna.email, 'test');
    expect((await listAppTools(runCtx, helper)).map((t) => t.resourceId)).toContain(
      'crm.contacts.list',
    );
  });

  it('Fragen nach anderen Subjekten gehen unveraendert durch', async () => {
    const runCtx = contextForRun(f.ctx, await queuedRun(f, 'helper', anna));
    expect(await listAppTools(runCtx, { kind: 'user', id: 'u-nobody' })).toEqual([]);
    expect((await listAppTools(runCtx, plain)).map((t) => t.resourceId)).toEqual([
      'wiki.pages.get',
    ]);
  });
});

describe('lokale Apps im Lauf (C2)', () => {
  it('externer Anbieter: der Lauf sieht die Tools der lokalen App nicht', async () => {
    const f = await fixture(chatSetup(createScriptedModelProvider({ local: false }), ['crm']));
    const runCtx = contextForRun(f.ctx, await queuedRun(f, 'helper', ben));
    expect((await listAppTools(runCtx, helper)).map((t) => t.resourceId)).toEqual([
      'wiki.pages.get',
    ]);
    await expect(
      callAppTool(runCtx, {
        actor: helper,
        toolResourceId: 'crm.contacts.list',
        invoker: f.invoker,
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('lokaler Anbieter: dieselben Tools sind da', async () => {
    const f = await fixture(
      chatSetup(createScriptedModelProvider({ kind: 'openai-compatible', local: true }), ['crm']),
    );
    const runCtx = contextForRun(f.ctx, await queuedRun(f, 'helper', ben));
    expect((await listAppTools(runCtx, helper)).map((t) => t.resourceId)).toContain(
      'crm.contacts.list',
    );
  });
});

describe('Starten (Schritt 4)', () => {
  it('ohne execute auf agent:<name> kein Lauf, 403 mit Audit', async () => {
    const f = await fixture(chatSetup(createScriptedModelProvider()));
    const cleo = { id: 'u-cleo', email: 'cleo@example.com' };
    await expect(
      startAgentRun(f.ctx, {
        actor: asUser(cleo),
        email: cleo.email,
        agent: 'helper',
        prompt: 'Hi',
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(f.harness.store.agentRuns.all()).toHaveLength(0);
    expect(f.harness.store.auditEntries.at(-1)).toMatchObject({
      action: 'start_agent_run',
      outcome: 'denied',
      resource: { kind: 'agent', id: 'helper' },
    });
  });

  it('ohne Modell not_configured, kein Lauf', async () => {
    const f = await fixture();
    await expect(
      startAgentRun(f.ctx, { actor: asUser(ben), email: ben.email, agent: 'helper', prompt: 'Hi' }),
    ).rejects.toBeInstanceOf(NotConfiguredError);
    expect(f.harness.store.agentRuns.all()).toHaveLength(0);
    expect(await listAgentProfiles(f.ctx, { actor: asUser(ben) })).toMatchObject({
      chat: 'not_configured',
    });
  });

  it('ein Agent ohne Profil oder gesperrt ist kein Plattform-Agent', async () => {
    const f = await fixture(chatSetup(createScriptedModelProvider()));
    await createAgentIdentity(f.ctx, { actor: admin, name: 'external' });
    await give(f.ctx, asUser(ben), 'execute', { kind: 'agent', id: 'external' });
    await expect(
      startAgentRun(f.ctx, {
        actor: asUser(ben),
        email: ben.email,
        agent: 'external',
        prompt: 'Hi',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await disableAgentIdentity(f.ctx, { actor: admin, name: 'helper' });
    await expect(
      startAgentRun(f.ctx, { actor: asUser(ben), email: ben.email, agent: 'helper', prompt: 'Hi' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('configure_agent braucht write auf den Agenten und prueft die Grenzen', async () => {
    const f = await fixture(chatSetup(createScriptedModelProvider()));
    await expect(
      configureAgent(f.ctx, { actor: asUser(ben), name: 'helper', instructions: 'Take over.' }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(
      configureAgent(f.ctx, { actor: admin, name: 'helper', instructions: 'x', maxSteps: 99 }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(f.harness.store.auditEntries.at(-1)).toMatchObject({
      action: 'configure_agent',
      outcome: 'error',
    });
    const profiles = await listAgentProfiles(f.ctx, { actor: asUser(ben) });
    // Ben darf starten, aber nicht lesen: keine Anweisungen.
    expect(profiles.agents.find((a) => a.agent === 'helper')).toMatchObject({
      canStart: true,
      canEdit: false,
      instructions: null,
    });
  });
});

describe('Ausfuehren', () => {
  it('jeder Tool-Aufruf steht im Audit mit der Lauf-Id, das Ergebnis im Lauf', async () => {
    const provider = createScriptedModelProvider({
      replies: [{ toolCalls: [call('crm__contacts__list')] }, { text: 'Two new contacts.' }],
    });
    const f = await fixture(chatSetup(provider));
    await queuedRun(f, 'helper', ben);
    const claimed = await claimAgentRun(f.ctx);
    expect(claimed?.status).toBe('running');
    const finished = await executeAgentRun(f.ctx, { run: claimed!, toolbox: appToolbox(f) });

    expect(finished).toMatchObject({ status: 'succeeded', result: 'Two new contacts.', steps: 2 });
    expect(finished.usedApps).toEqual(['crm']);
    expect(finished.toolCalls.map((c) => [c.tool, c.ok])).toEqual([['crm__contacts__list', true]]);
    expect(f.invoked).toEqual([{ app: 'crm', tool: 'contacts.list', actor: 'agent:helper' }]);
    const toolAudit = f.harness.store.auditEntries.filter((e) => e.action === 'call_app_tool');
    expect(toolAudit).toHaveLength(1);
    expect(toolAudit[0]).toMatchObject({ correlationId: finished.id, outcome: 'allowed' });
    const modelAudit = f.harness.store.auditEntries.filter((e) => e.action === 'model_call');
    expect(modelAudit.every((e) => e.correlationId === finished.id)).toBe(true);
    expect(
      f.harness.store.modelUsage.rows.every(
        (row) => row.runId === finished.id && row.purpose === 'agent_run',
      ),
    ).toBe(true);
    // Das Modell sah das Tool-Ergebnis, nicht mehr.
    expect(JSON.stringify(provider.chats[1]?.messages.at(-1))).toContain('row from crm');
    // Die Anweisungen des Profils stehen im System-Prompt.
    expect(provider.chats[0]?.system).toContain('You are helper.');
  });

  it('Anna startet helper: das Modell bekommt keine CRM-Tools angeboten', async () => {
    const provider = createScriptedModelProvider({
      replies: [{ toolCalls: [call('crm__contacts__list')] }],
    });
    const f = await fixture(chatSetup(provider));
    await queuedRun(f, 'helper', anna);
    const finished = await executeAgentRun(f.ctx, {
      run: (await claimAgentRun(f.ctx))!,
      toolbox: appToolbox(f),
    });
    expect(provider.chats[0]?.tools?.map((t) => t.name)).toEqual(['wiki__pages__get']);
    // Ein Name, der nicht angeboten wurde, laeuft nicht.
    expect(finished.toolCalls).toEqual([
      expect.objectContaining({ tool: 'crm__contacts__list', ok: false }),
    ]);
    expect(f.invoked).toHaveLength(0);
  });

  it('Schrittzahl und Budget begrenzen den Lauf', async () => {
    const looping = createScriptedModelProvider({
      replies: Array.from({ length: 10 }, () => ({ toolCalls: [call('wiki__pages__get')] })),
    });
    const f = await fixture(chatSetup(looping));
    await queuedRun(f, 'helper', ben);
    const stopped = await executeAgentRun(f.ctx, {
      run: (await claimAgentRun(f.ctx))!,
      toolbox: appToolbox(f),
    });
    expect(stopped).toMatchObject({ status: 'failed', errorCode: 'max_steps', steps: 4 });

    const expensive = createScriptedModelProvider({
      usage: { inputTokens: 900, outputTokens: 0 },
      replies: Array.from({ length: 10 }, () => ({ toolCalls: [call('wiki__pages__get')] })),
    });
    const g = await fixture(chatSetup(expensive));
    await configureAgent(g.ctx, {
      actor: admin,
      name: 'helper',
      instructions: 'x',
      tokenBudget: 2000,
    });
    await queuedRun(g, 'helper', ben);
    const broke = await executeAgentRun(g.ctx, {
      run: (await claimAgentRun(g.ctx))!,
      toolbox: appToolbox(g),
    });
    expect(broke).toMatchObject({ status: 'failed', errorCode: 'budget_exceeded', steps: 2 });
  });

  it('ist die Freigabe zum Starten bis zum Lauf weg, endet er ohne Modell-Aufruf', async () => {
    const provider = createScriptedModelProvider();
    const f = await fixture(chatSetup(provider));
    await queuedRun(f, 'helper', ben);
    const startGrant = (await f.ctx.grants.listForSubjects([{ kind: 'user', id: ben.id }])).find(
      (g) => g.resource.kind === 'agent' && g.resource.id === 'helper',
    );
    await revoke(f.ctx, { actor: admin, grantId: startGrant!.id });
    const finished = await executeAgentRun(f.ctx, {
      run: (await claimAgentRun(f.ctx))!,
      toolbox: appToolbox(f),
    });
    expect(finished).toMatchObject({ status: 'failed', errorCode: 'permission_denied' });
    expect(provider.chats).toHaveLength(0);
  });

  it('ohne Modell zur Laufzeit not_configured, ohne Aufruf', async () => {
    const f = await fixture(chatSetup(createScriptedModelProvider()));
    await queuedRun(f, 'helper', ben);
    const { models: _ignored, ...withoutModels } = f.ctx;
    const finished = await executeAgentRun(withoutModels, {
      run: (await claimAgentRun(f.ctx))!,
      toolbox: appToolbox(f),
    });
    expect(finished).toMatchObject({ status: 'failed', errorCode: 'not_configured' });
  });
});

describe('wer einen Lauf sieht', () => {
  it('der Ausloeser, solange er alle Apps der Herkunft lesen darf; sonst niemand ohne write auf den Agenten', async () => {
    const provider = createScriptedModelProvider({
      replies: [{ toolCalls: [call('crm__contacts__list')] }, { text: 'Contacts: Alice.' }],
    });
    const f = await fixture(chatSetup(provider));
    await queuedRun(f, 'helper', ben);
    const finished = await executeAgentRun(f.ctx, {
      run: (await claimAgentRun(f.ctx))!,
      toolbox: appToolbox(f),
    });

    expect((await getAgentRun(f.ctx, { actor: asUser(ben), id: finished.id })).result).toBe(
      'Contacts: Alice.',
    );
    await expect(
      getAgentRun(f.ctx, { actor: asUser(anna), id: finished.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect((await listAgentRuns(f.ctx, { actor: asUser(anna) })).runs).toEqual([]);
    // Der Administrator pflegt den Agenten und liest das CRM.
    expect((await listAgentRuns(f.ctx, { actor: admin })).runs.map((r) => r.id)).toEqual([
      finished.id,
    ]);

    await revoke(f.ctx, { actor: admin, grantId: f.grants.benCrm!.id });
    await expect(
      getAgentRun(f.ctx, { actor: asUser(ben), id: finished.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect((await listAgentRuns(f.ctx, { actor: asUser(ben) })).runs).toEqual([]);
  });
});

describe('Erwaehnung im Wiki (Schritt 4)', () => {
  const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  const mention = (f: Fixture, actor: string, updatedAt = minutesAgo(10)) =>
    setRefs(f.ctx, {
      actor: WIKI,
      args: {
        source: 'wiki:page:p1',
        targets: ['agent:helper'],
        updatedAt,
        title: 'Weekly notes',
        path: '/pages/p1',
        actor,
      },
    });

  it('startet genau einen Lauf; dieselbe Meldung noch einmal startet keinen zweiten', async () => {
    const f = await fixture(chatSetup(createScriptedModelProvider()));
    await mention(f, 'user:u-ben');
    await mention(f, 'user:u-ben');
    await mention(f, 'user:u-ben', minutesAgo(5));
    const runs = f.harness.store.agentRuns.all();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      agentName: 'helper',
      triggerKind: 'mention',
      trigger: { kind: 'user', id: 'u-ben', email: 'ben@example.com' },
      source: 'wiki:page:p1',
      sourceApp: 'wiki',
      usedApps: ['wiki'],
    });
    expect(runs[0]?.prompt).toContain('Weekly notes');
    expect(f.harness.store.auditEntries.at(-1)).toMatchObject({
      action: 'start_agent_run',
      outcome: 'allowed',
      actor: { kind: 'user', id: 'u-ben' },
    });
  });

  it('das Ergebnis steht im Eingang des Ausloesers, als Ereignis der Quell-App', async () => {
    const f = await fixture(
      chatSetup(createScriptedModelProvider({ replies: [{ text: 'Done.' }] })),
    );
    await mention(f, 'user:u-ben');
    const finished = await executeAgentRun(f.ctx, {
      run: (await claimAgentRun(f.ctx))!,
      toolbox: appToolbox(f),
    });
    expect(finished.status).toBe('succeeded');
    const inbox = await listInbox(f.ctx, { actor: asUser(ben), email: ben.email });
    expect(inbox.items.map((item) => [item.type, item.title, item.app])).toEqual([
      ['platform.agent_run_finished', 'Helper answered your mention', 'wiki'],
    ]);
    // Anna bekommt nichts.
    expect((await listInbox(f.ctx, { actor: asUser(anna), email: anna.email })).items).toEqual([]);
  });

  it('ohne execute auf den Agenten kein Lauf, aber ein Audit-Eintrag', async () => {
    const f = await fixture(chatSetup(createScriptedModelProvider()));
    const annaGrant = (await f.ctx.grants.listForSubjects([{ kind: 'user', id: anna.id }])).find(
      (g) => g.resource.kind === 'agent' && g.resource.id === 'helper',
    );
    await revoke(f.ctx, { actor: admin, grantId: annaGrant!.id });
    await mention(f, 'user:u-anna');
    expect(f.harness.store.agentRuns.all()).toHaveLength(0);
    expect(f.harness.store.auditEntries.at(-1)).toMatchObject({
      action: 'start_agent_run',
      outcome: 'denied',
      actor: { kind: 'user', id: 'u-anna' },
      resource: { kind: 'agent', id: 'helper' },
    });
  });

  it('ohne Person kein Lauf; ohne Modell kein Lauf; beides im Audit', async () => {
    const f = await fixture(chatSetup(createScriptedModelProvider()));
    await setRefs(f.ctx, {
      actor: WIKI,
      args: {
        source: 'wiki:page:p2',
        targets: ['agent:helper'],
        updatedAt: minutesAgo(10),
      },
    });
    expect(f.harness.store.auditEntries.at(-1)).toMatchObject({
      action: 'start_agent_run',
      outcome: 'denied',
    });

    const g = await fixture();
    await mention(g, 'user:u-ben');
    expect(g.harness.store.agentRuns.all()).toHaveLength(0);
    expect(g.harness.store.auditEntries.at(-1)).toMatchObject({
      action: 'start_agent_run',
      outcome: 'error',
    });
    expect(String(g.harness.store.auditEntries.at(-1)?.reason)).toContain('not_configured');
  });

  it('ein Agent ohne read auf die Quell-App bekommt die Erwaehnung nicht und startet nicht', async () => {
    const f = await fixture(chatSetup(createScriptedModelProvider()));
    await createAgentIdentity(f.ctx, { actor: admin, name: 'blind' });
    await configureAgent(f.ctx, { actor: admin, name: 'blind', instructions: 'x' });
    await give(f.ctx, asUser(ben), 'execute', { kind: 'agent', id: 'blind' });
    await setRefs(f.ctx, {
      actor: WIKI,
      args: {
        source: 'wiki:page:p3',
        targets: ['agent:blind'],
        updatedAt: minutesAgo(10),
        actor: 'user:u-ben',
      },
    });
    expect(f.harness.store.agentRuns.all()).toHaveLength(0);
  });

  it('lokal-only Quelle bei externem Anbieter: kein Lauf', async () => {
    const f = await fixture(chatSetup(createScriptedModelProvider({ local: false }), ['wiki']));
    await mention(f, 'user:u-ben');
    expect(f.harness.store.agentRuns.all()).toHaveLength(0);
    expect(String(f.harness.store.auditEntries.at(-1)?.reason)).toContain('withheld');
  });
});
