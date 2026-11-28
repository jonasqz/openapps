/**
 * Tool-Suche nach Bedarf (ADR 0024, Nachtrag Code Mode, Punkt 1):
 * `search_tools` und `describe_tool` ueber einen echten MCP-Client im
 * Prozess, gegen denselben Server wie `/mcp`.
 *
 * Die riskanten Pfade zuerst:
 *
 * - Ohne Freigabe taucht ein App-Tool in `search_tools` nicht auf, und
 *   `describe_tool` antwortet genau so wie fuer ein Tool, das es nicht gibt.
 *   Sonst verriete die Suche, was es gibt, ohne dass jemand es freigab.
 * - Mit Freigabe findet und beschreibt der Agent das Tool.
 * - Ein Widerruf blendet es beim naechsten Aufruf aus, ohne neue Verbindung.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { describe, expect, it } from 'vitest';
import { createApp, grant, revoke } from '@openapps/control-plane/domain';
import type { Actor, AppManifest } from '@openapps/control-plane/domain';
import { createPlatformServer } from '../src/server';
import { rankTools, toolSummary, type CatalogEntry } from '../src/tool-catalog';
import {
  admin,
  createCountingInvoker,
  createHarness,
  seedBootstrapGrants,
  type Harness,
} from './helpers';

const planer: Actor = { kind: 'agent', id: 'planer' };
const neugierig: Actor = { kind: 'agent', id: 'neugierig' };

const manifest: AppManifest = {
  manifestVersion: 1,
  name: 'tasks',
  displayName: 'Tasks',
  description: 'Tasks for the test',
  category: 'test',
  version: '1.0.0',
  requiredTables: [{ name: 'tasks', description: 'Tasks' }],
  offeredTools: [
    {
      name: 'tasks.create',
      description: 'Creates a task with a title and an optional assignee. Returns the new task.',
      verb: 'write',
      operationId: 'create',
    },
    {
      name: 'tasks.delete',
      description: 'Deletes a task for good.',
      verb: 'write',
      operationId: 'delete',
    },
  ],
  requestedGrants: [],
  env: [],
  egress: [],
  source: { git: 'https://example.invalid/tasks.git', tag: 'v1.0.0' },
};

interface Hit {
  readonly name: string;
  readonly kind: string;
  readonly resourceId: string;
  readonly app: string;
  readonly summary: string;
}

interface Connection {
  call(name: string, args: Record<string, unknown>): Promise<{ isError: boolean; body: unknown }>;
  search(args: Record<string, unknown>): Promise<readonly Hit[]>;
  close(): Promise<void>;
}

async function connect(harness: Harness, actor: Actor): Promise<Connection> {
  const server = await createPlatformServer({
    ctx: harness.ctx,
    actor,
    invoker: createCountingInvoker(),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  // Dieselbe enge Zusicherung wie in `run-toolbox.ts`.
  await server.connect(serverTransport as unknown as Transport);
  const client = new Client({ name: 'tool-search-test', version: '0.1.0' });
  await client.connect(clientTransport as unknown as Transport);

  const call: Connection['call'] = async (name, args) => {
    const result = await client.callTool({ name, arguments: args });
    const content = result.content as { type: string; text: string }[];
    return {
      isError: result.isError === true,
      body: JSON.parse(content[0]?.text ?? 'null') as unknown,
    };
  };
  return {
    call,
    async search(args) {
      const { body } = await call('search_tools', args);
      return (body as { value: { tools: Hit[] } }).value.tools;
    },
    async close() {
      await client.close();
      await server.close();
    },
  };
}

async function setup(): Promise<Harness> {
  const harness = createHarness();
  await seedBootstrapGrants(harness);
  await createApp(harness.ctx, { actor: admin, name: 'tasks', manifest });
  return harness;
}

function grantCreate(harness: Harness, subject: Actor) {
  return grant(harness.ctx, {
    actor: admin,
    subject,
    verb: 'execute',
    resource: { kind: 'tool', id: 'tasks.tasks.create' },
  });
}

describe('search_tools und describe_tool: nur was der Aufrufer ausfuehren darf', () => {
  it('ohne Freigabe: kein Treffer, und describe_tool antwortet wie fuer ein unbekanntes Tool', async () => {
    const harness = await setup();
    // Ein anderer Agent hat die Freigabe; das darf nichts aendern.
    await grantCreate(harness, planer);
    const mcp = await connect(harness, neugierig);

    const hits = await mcp.search({ query: 'create task' });
    expect(hits.map((hit) => hit.app)).not.toContain('tasks');
    expect(await mcp.search({ query: 'tasks', apps: ['tasks'] })).toEqual([]);

    const vorhanden = await mcp.call('describe_tool', { name: 'tasks__tasks__create' });
    const ueberId = await mcp.call('describe_tool', { name: 'tasks.tasks.create' });
    const erfunden = await mcp.call('describe_tool', { name: 'nothing__here' });
    expect(vorhanden.isError).toBe(true);
    expect(vorhanden.body).toEqual({
      ok: false,
      error: { code: 'not_found', message: 'unknown tool "tasks__tasks__create"' },
    });
    expect(ueberId.body).toEqual({
      ok: false,
      error: { code: 'not_found', message: 'unknown tool "tasks.tasks.create"' },
    });
    // Dieselbe Antwort, bis auf den Namen, den der Aufrufer selbst schickte.
    expect(erfunden.body).toEqual({
      ok: false,
      error: { code: 'not_found', message: 'unknown tool "nothing__here"' },
    });
    await mcp.close();
  });

  it('mit Freigabe: findet das Tool mit MCP-Name, Ressourcen-Id, App und Kurzbeschreibung', async () => {
    const harness = await setup();
    await grantCreate(harness, planer);
    const mcp = await connect(harness, planer);

    const hits = await mcp.search({ query: 'create task' });
    expect(hits[0]).toEqual({
      name: 'tasks__tasks__create',
      kind: 'app',
      resourceId: 'tasks.tasks.create',
      app: 'tasks',
      summary: 'Creates a task with a title and an optional assignee.',
    });
    // Das nicht freigegebene Tool derselben App bleibt unsichtbar.
    expect(hits.map((hit) => hit.name)).not.toContain('tasks__tasks__delete');
    expect((await mcp.search({ query: 'delete', apps: ['tasks'] })).length).toBe(0);

    const described = await mcp.call('describe_tool', { name: 'tasks__tasks__create' });
    expect(described.isError).toBe(false);
    const tool = (described.body as { value: { tool: Record<string, unknown> } }).value.tool;
    expect(tool).toMatchObject({
      name: 'tasks__tasks__create',
      kind: 'app',
      resourceId: 'tasks.tasks.create',
      app: 'tasks',
    });
    expect(tool.description).toContain('Creates a task with a title and an optional assignee.');
    expect(tool.inputSchema).toMatchObject({ type: 'object', properties: { args: {} } });
    expect(tool.inputSchema).not.toHaveProperty('$schema');

    // Ueber die Ressourcen-Id dasselbe Tool.
    const byId = await mcp.call('describe_tool', { name: 'tasks.tasks.create' });
    expect((byId.body as { value: { tool: { name: string } } }).value.tool.name).toBe(
      'tasks__tasks__create',
    );
    // Das nicht freigegebene: nicht gefunden.
    expect((await mcp.call('describe_tool', { name: 'tasks__tasks__delete' })).body).toEqual({
      ok: false,
      error: { code: 'not_found', message: 'unknown tool "tasks__tasks__delete"' },
    });
    await mcp.close();
  });

  it('nach dem Widerruf beim naechsten Aufruf ausgeblendet, ohne neue Verbindung', async () => {
    const harness = await setup();
    const granted = await grantCreate(harness, planer);
    const mcp = await connect(harness, planer);

    expect((await mcp.search({ query: 'create task' })).map((hit) => hit.name)).toContain(
      'tasks__tasks__create',
    );
    expect((await mcp.call('describe_tool', { name: 'tasks__tasks__create' })).isError).toBe(false);

    await revoke(harness.ctx, { actor: admin, grantId: granted.id });

    expect((await mcp.search({ query: 'create task' })).map((hit) => hit.name)).not.toContain(
      'tasks__tasks__create',
    );
    expect((await mcp.call('describe_tool', { name: 'tasks__tasks__create' })).body).toEqual({
      ok: false,
      error: { code: 'not_found', message: 'unknown tool "tasks__tasks__create"' },
    });
    await mcp.close();
  });
});

describe('search_tools: Plattform-Tools, Grenzen, Audit', () => {
  it('findet Plattform-Tools, der exakte Name zuerst', async () => {
    const harness = await setup();
    const mcp = await connect(harness, neugierig);
    const hits = await mcp.search({ query: 'list_inbox' });
    expect(hits[0]).toMatchObject({
      name: 'list_inbox',
      kind: 'platform',
      resourceId: 'platform.list_inbox',
      app: 'platform',
    });
    const both = await mcp.search({ query: 'describe tool' });
    expect(both.map((hit) => hit.name)).toContain('describe_tool');

    const described = await mcp.call('describe_tool', { name: 'search' });
    const tool = (described.body as { value: { tool: Record<string, unknown> } }).value.tool;
    expect(tool).toMatchObject({ name: 'search', kind: 'platform', app: 'platform' });
    expect(tool.inputSchema).toMatchObject({
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    });
    await mcp.close();
  });

  it('prueft Eingaben: zu kurze Anfrage, zu grosses limit', async () => {
    const harness = await setup();
    const mcp = await connect(harness, neugierig);
    for (const args of [{ query: 'a' }, { query: '--' }, { query: 'task', limit: 0 }]) {
      const result = await mcp.call('search_tools', args);
      expect(result.isError).toBe(true);
      expect(result.body).toMatchObject({ ok: false, error: { code: 'validation_failed' } });
    }
    const capped = await mcp.search({ query: 'list', limit: 3 });
    expect(capped.length).toBeLessThanOrEqual(3);
    await mcp.close();
  });

  it('protokolliert jeden Aufruf, ohne den Suchtext', async () => {
    const harness = await setup();
    await grantCreate(harness, planer);
    const mcp = await connect(harness, planer);
    await mcp.search({ query: 'secret project name' });
    await mcp.call('describe_tool', { name: 'tasks__tasks__delete' });
    await mcp.call('describe_tool', { name: 'tasks__tasks__create' });

    const searched = harness.store.auditEntries.filter((e) => e.action === 'search_tools');
    expect(searched).toHaveLength(1);
    expect(searched[0]?.outcome).toBe('allowed');
    expect(JSON.stringify(searched[0])).not.toContain('secret project name');

    const described = harness.store.auditEntries.filter((e) => e.action === 'describe_tool');
    expect(described.map((e) => e.outcome)).toEqual(['error', 'allowed']);
    expect(described[0]?.resource ?? null).toBeNull();
    expect(described[1]?.resource).toEqual({ kind: 'tool', id: 'tasks.tasks.create' });
    await mcp.close();
  });
});

describe('Rangfolge', () => {
  const entry = (name: string, description: string): CatalogEntry => ({
    name,
    kind: 'platform',
    resourceId: `platform.${name}`,
    app: 'platform',
    title: name,
    description,
    summary: description,
    inputSchema: { type: 'object', properties: {} },
  });

  it('exakter Name vor Treffer im Namen vor Treffer in der Beschreibung', () => {
    const entries = [
      entry('recall', 'Searches the team memory.'),
      entry('search_tools', 'Finds tools.'),
      entry('search', 'Searches all apps.'),
    ];
    expect(rankTools(entries, 'search', 10).map((e) => e.name)).toEqual([
      'search',
      'search_tools',
      'recall',
    ]);
    expect(rankTools(entries, 'nothing matches', 10)).toEqual([]);
  });

  it('Kurzbeschreibung: erster Satz, hoechstens eine Zeile', () => {
    expect(toolSummary('First. Second.')).toBe('First.');
    expect(toolSummary('Line one\nline two')).toBe('Line one');
    expect(toolSummary('x'.repeat(400)).length).toBeLessThanOrEqual(160);
  });
});
