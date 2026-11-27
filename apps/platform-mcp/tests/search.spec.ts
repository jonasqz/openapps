/**
 * Das MCP-Tool `search` (ADR 0021): dieselbe Suche wie die Leiste, fuer
 * Agents. Zuerst, was fehlen muss: Ein Agent bekommt eine App nur mit `read`
 * auf die App und `execute` auf ihr Such-Tool. Neue Such-Tools sind damit
 * fuer Agents gesperrt, bis jemand sie freigibt.
 */

import { describe, expect, it } from 'vitest';
import { createApp, grant } from '@openapps/control-plane/domain';
import type { Actor, AppManifest, AppToolInvoker } from '@openapps/control-plane/domain';
import { platformTools, runTool, searchTool } from '../src/tools';
import { admin, createHarness, seedBootstrapGrants, type Harness } from './helpers';

const finder: Actor = { kind: 'agent', id: 'finder' };

function searchable(name: string, tool: string): AppManifest {
  return {
    manifestVersion: 1,
    name,
    displayName: name.toUpperCase(),
    description: `Test-App ${name}`,
    category: 'test',
    version: '1.0.0',
    requiredTables: [],
    offeredTools: [
      { name: tool, description: 'Sucht', verb: 'read', operationId: 'search' },
      { name: 'items.delete', description: 'Loescht', verb: 'write', operationId: 'delete' },
    ],
    requestedGrants: [],
    env: [],
    egress: [],
    search: { tool },
    source: { git: `https://example.invalid/${name}.git`, tag: 'v1.0.0' },
  };
}

function invoker(): AppToolInvoker & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async invoke({ app, toolName }) {
      calls.push(`${app.name}.${toolName}`);
      if (app.name === 'tasks') throw new Error('app "tasks" responded 500');
      return { hits: [{ id: '1', title: `Hit in ${app.name}`, url: '/items/1', kind: 'item' }] };
    },
  };
}

async function setup(): Promise<Harness> {
  const harness = createHarness();
  await seedBootstrapGrants(harness);
  for (const [name, tool] of [
    ['crm', 'search'],
    ['wiki', 'pages.search'],
    ['tasks', 'search'],
  ] as const) {
    await createApp(harness.ctx, { actor: admin, name, manifest: searchable(name, tool) });
    // Ohne Domain gilt eine App als nie deployt und nimmt nicht teil.
    const app = await harness.store.apps.findByName(name);
    await harness.store.apps.setPrimaryDomain(app?.id ?? '', 'apps.example.com');
  }
  return harness;
}

async function allow(harness: Harness, resource: { kind: 'app' | 'tool'; id: string }) {
  await grant(harness.ctx, {
    actor: admin,
    subject: finder,
    verb: resource.kind === 'app' ? 'read' : 'execute',
    resource,
  });
}

describe('search im Plattform-MCP', () => {
  it('ist ein Plattform-Tool und braucht keine eigene Freigabe', () => {
    expect(platformTools.map((tool) => tool.name)).toContain('search');
  });

  it('fragt fuer einen Agenten ohne Freigaben keine App', async () => {
    const harness = await setup();
    const apps = invoker();
    const result = await runTool(
      searchTool,
      { ctx: harness.ctx, actor: finder, invoker: apps },
      { query: 'angebot' },
    );
    expect(result.ok).toBe(true);
    expect(apps.calls).toEqual([]);
    expect(result.value).toMatchObject({ results: [], failed: [], searched: [] });
  });

  it('braucht read auf die App und execute auf genau ihr Such-Tool', async () => {
    const harness = await setup();
    await allow(harness, { kind: 'app', id: 'crm' });
    // execute auf ein anderes Tool der App reicht nicht.
    await allow(harness, { kind: 'tool', id: 'crm.items.delete' });
    await allow(harness, { kind: 'app', id: 'wiki' });
    await allow(harness, { kind: 'tool', id: 'wiki.pages.search' });

    const apps = invoker();
    const result = await runTool(
      searchTool,
      { ctx: harness.ctx, actor: finder, invoker: apps },
      { query: 'angebot' },
    );
    expect(apps.calls).toEqual(['wiki.pages.search']);
    expect(result.value).toMatchObject({
      results: [
        {
          app: 'wiki',
          title: 'WIKI',
          hits: [{ id: '1', href: 'https://apps.example.com/wiki/items/1', kind: 'item' }],
        },
      ],
    });
  });

  it('meldet eine App mit Fehler unter failed, die anderen antworten', async () => {
    const harness = await setup();
    for (const [app, tool] of [
      ['crm', 'crm.search'],
      ['tasks', 'tasks.search'],
    ] as const) {
      await allow(harness, { kind: 'app', id: app });
      await allow(harness, { kind: 'tool', id: tool });
    }
    const apps = invoker();
    const result = await runTool(
      searchTool,
      { ctx: harness.ctx, actor: finder, invoker: apps },
      { query: 'angebot', apps: ['crm', 'tasks'], limit: 2 },
    );
    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({
      results: [{ app: 'crm' }],
      failed: [{ app: 'tasks', reason: 'error' }],
      searched: ['crm'],
    });
  });

  it('weist einen zu kurzen Suchtext ab und protokolliert den Aufruf', async () => {
    const harness = await setup();
    const result = await runTool(
      searchTool,
      { ctx: harness.ctx, actor: finder, invoker: invoker() },
      { query: 'a' },
    );
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('validation_failed');
    const entry = harness.store.auditEntries.at(-1);
    expect(entry?.action).toBe('search');
    expect(entry?.outcome).toBe('error');
  });

  it('scheitert ohne Weiterleitung klar statt still leer', async () => {
    const harness = await setup();
    const result = await runTool(searchTool, { ctx: harness.ctx, actor: finder }, { query: 'ab' });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/not available/);
  });
});
