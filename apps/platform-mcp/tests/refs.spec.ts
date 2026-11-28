/**
 * Die MCP-Tools der Verweise (ADR 0023) fuer Agents. Riskant zuerst: Ein
 * Agent bekommt einen Titel nur mit `read` auf die Ziel-App und `execute`
 * auf ihren Resolver, Aktionen nur mit `execute` auf ihr Tool, und den
 * Rueckverweis `derived`, wenn er per MCP eine Aufgabe aus einer Wiki-Seite
 * anlegt (die Ziel-App meldet ihn ueber `set_refs`).
 */

import { describe, expect, it } from 'vitest';
import {
  callAppTool,
  createApp,
  createRefCache,
  grant,
  setRefs,
  type Actor,
  type AppManifest,
  type AppToolInvoker,
} from '@openapps/control-plane/domain';
import {
  listActionsTool,
  listBacklinksTool,
  listPeopleTool,
  platformTools,
  resolveRefsTool,
  runTool,
} from '../src/tools';
import { admin, createHarness, seedBootstrapGrants, type Harness } from './helpers';

const helper: Actor = { kind: 'agent', id: 'helper' };

function app(name: string, extra: Partial<AppManifest>): AppManifest {
  return {
    manifestVersion: 1,
    name,
    displayName: name.toUpperCase(),
    description: `Test-App ${name}`,
    category: 'test',
    version: '1.0.0',
    requiredTables: [],
    offeredTools: [],
    requestedGrants: [],
    env: [],
    egress: [],
    source: { git: `https://example.invalid/${name}.git`, tag: 'v1.0.0' },
    ...extra,
  };
}

const tasks = app('tasks', {
  offeredTools: [
    { name: 'resolve', description: 'Resolve.', verb: 'read', operationId: 'resolve' },
    { name: 'tasks.create_from_ref', description: 'Create.', verb: 'write', operationId: 'c' },
  ],
  objects: [{ type: 'task', description: 'A task.', resolver: 'resolve' }],
  actions: [
    {
      name: 'task_from_ref',
      title: 'Create task',
      accepts: ['wiki:page'],
      tool: 'tasks.create_from_ref',
      path: '/new',
    },
  ],
});
const wiki = app('wiki', {
  offeredTools: [
    { name: 'pages.resolve', description: 'Resolve.', verb: 'read', operationId: 'r' },
  ],
  objects: [{ type: 'page', description: 'A page.', resolver: 'pages.resolve' }],
});

/** Tasks im Test: legt aus einer Quelle eine Aufgabe an und meldet `derived`. */
function tasksApp(harness: Harness): AppToolInvoker {
  return {
    async invoke({ app: target, toolName, args }) {
      if (toolName === 'tasks.create_from_ref') {
        await setRefs(harness.ctx, {
          actor: { kind: 'app', id: 'tasks' },
          args: {
            source: 'tasks:task:t-new',
            targets: [{ ref: String(args.sourceRef), kind: 'derived' }],
            updatedAt: new Date(Date.now() - 1000).toISOString(),
          },
        });
        return { task: { id: 't-new' } };
      }
      return {
        objects: ((args.ids as string[]) ?? []).map((id) => ({
          id,
          title: `${target.name} ${id}`,
          path: `/x/${id}`,
          updatedAt: '2026-01-01T00:00:00.000Z',
        })),
      };
    },
  };
}

async function setup(): Promise<Harness> {
  const harness = createHarness();
  await seedBootstrapGrants(harness);
  for (const manifest of [tasks, wiki]) {
    await createApp(harness.ctx, { actor: admin, name: manifest.name, manifest });
    const created = await harness.store.apps.findByName(manifest.name);
    await harness.store.apps.setPrimaryDomain(created?.id ?? '', 'apps.example.com');
  }
  return harness;
}

const allow = (harness: Harness, verb: 'read' | 'execute', kind: 'app' | 'tool', id: string) =>
  grant(harness.ctx, {
    actor: admin,
    subject: { kind: 'agent', id: 'helper' },
    verb,
    resource: { kind, id },
  });

describe('Verweise im Plattform-MCP', () => {
  it('sind als Tools angemeldet', () => {
    const names = platformTools.map((tool) => tool.name);
    for (const name of ['resolve_refs', 'list_backlinks', 'list_people', 'list_actions']) {
      expect(names).toContain(name);
    }
  });

  it('resolve_refs: ohne Freigaben restricted, mit read und execute auf den Resolver der Titel', async () => {
    const harness = await setup();
    const call = {
      ctx: harness.ctx,
      actor: helper,
      invoker: tasksApp(harness),
      refCache: createRefCache(),
    };
    const first = await runTool(resolveRefsTool, call, { refs: ['tasks:task:42'] });
    expect(first.value).toEqual({ results: [{ ref: 'tasks:task:42', state: 'restricted' }] });
    await allow(harness, 'read', 'app', 'tasks');
    await allow(harness, 'execute', 'tool', 'tasks.resolve');
    const second = await runTool(resolveRefsTool, call, { refs: ['tasks:task:42'] });
    expect(second.value).toMatchObject({ results: [{ state: 'resolved', title: 'tasks 42' }] });
  });

  it('Agent legt per MCP eine Aufgabe aus einer Wiki-Seite an, Rueckverweis derived erscheint', async () => {
    const harness = await setup();
    await grant(harness.ctx, {
      actor: admin,
      subject: { kind: 'app', id: 'tasks' },
      verb: 'execute',
      resource: { kind: 'tool', id: 'platform.set_refs' },
    });
    const invoker = tasksApp(harness);
    const call = { ctx: harness.ctx, actor: helper, invoker };

    // Ohne execute taucht die Aktion nicht auf.
    expect((await runTool(listActionsTool, call, { ref: 'wiki:page:p1' })).value).toEqual({
      ref: 'wiki:page:p1',
      actions: [],
    });
    await allow(harness, 'execute', 'tool', 'tasks.tasks.create_from_ref');
    const actions = await runTool(listActionsTool, call, { ref: 'wiki:page:p1' });
    expect(actions.value).toMatchObject({ actions: [{ tool: 'tasks.tasks.create_from_ref' }] });

    await callAppTool(harness.ctx, {
      actor: helper,
      toolResourceId: 'tasks.tasks.create_from_ref',
      args: { sourceRef: 'wiki:page:p1' },
      invoker,
    });

    await allow(harness, 'read', 'app', 'wiki');
    await allow(harness, 'read', 'app', 'tasks');
    const backlinks = await runTool(listBacklinksTool, call, { ref: 'wiki:page:p1' });
    expect(backlinks.value).toMatchObject({
      backlinks: [{ source: 'tasks:task:t-new', kind: 'derived', app: 'tasks' }],
    });
  });

  it('list_people ist leer fuer einen Agenten ohne read auf die App', async () => {
    const harness = await setup();
    const call = { ctx: harness.ctx, actor: helper };
    expect((await runTool(listPeopleTool, call, { app: 'wiki' })).value).toEqual({
      app: 'wiki',
      people: [],
    });
  });
});
