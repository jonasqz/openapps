/**
 * Die Prompts des Plattform-MCP, ueber einen echten MCP-Client: `loslegen`
 * ist dieselbe Anleitung wie die Seite /loslegen der Verwaltung.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { loslegenAlsText } from '@openapps/control-plane/loslegen';
import { createPlatformServer } from '../src/server';
import { createCountingInvoker, createHarness, seedBootstrapGrants } from './helpers';

describe('Prompts des Plattform-MCP', () => {
  it('bietet loslegen an, mit demselben Text wie die Verwaltung', async () => {
    const harness = createHarness();
    await seedBootstrapGrants(harness);
    const server = await createPlatformServer({
      ctx: harness.ctx,
      actor: { kind: 'agent', id: 'neu' },
      invoker: createCountingInvoker(),
    });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(clientSide);

    const names = (await client.listPrompts()).prompts.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(['loslegen', 'how_to_build_app']));

    const prompt = await client.getPrompt({ name: 'loslegen' });
    const content = prompt.messages[0]?.content;
    expect(content?.type === 'text' ? content.text : '').toBe(loslegenAlsText());
    await client.close();
  });
});
