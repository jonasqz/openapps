/**
 * Agent-Identitaeten als MCP-Tool, und der ganze Weg einmal durch: anlegen,
 * mit dem Token anmelden, sperren, abgewiesen werden.
 *
 * Die Domaenenlogik prueft `apps/control-plane/tests/agents.spec.ts`. Hier
 * steht, was nur an dieser Stelle zusammenkommt — das Token aus `create_agent`
 * ist genau das, was `actorForClient` annimmt.
 */

import { describe, expect, it } from 'vitest';
import { grant, parseAgentToken } from '@openapps/control-plane/domain';
import type { Actor, CreatedAgentIdentity } from '@openapps/control-plane/domain';
import { actorForClient, UnauthenticatedError } from '../src/identity';
import {
  createAgentTool,
  disableAgentTool,
  listAgentsTool,
  listAppsTool,
  platformTools,
  runTool,
} from '../src/tools';
import { admin, createHarness, seedBootstrapGrants, type Harness } from './helpers';

const fremd: Actor = { kind: 'user', id: 'u-niemand', groups: [] };

async function setup(): Promise<Harness> {
  const harness = createHarness();
  await seedBootstrapGrants(harness);
  return harness;
}

async function anlegen(harness: Harness, name: string): Promise<CreatedAgentIdentity> {
  const result = await runTool(createAgentTool, { ctx: harness.ctx, actor: admin }, { name });
  expect(result.ok).toBe(true);
  return result.value as CreatedAgentIdentity;
}

describe('Agent-Tools gibt es', () => {
  it('fuehrt alle drei in platformTools', () => {
    const namen = platformTools.map((tool) => tool.name);
    expect(namen).toContain('list_agents');
    expect(namen).toContain('create_agent');
    expect(namen).toContain('disable_agent');
    expect(new Set(namen).size).toBe(namen.length);
  });
});

describe('Vom Anlegen bis zur Sperre', () => {
  it('meldet den Agent mit dem ausgegebenen Token an und weist ihn nach der Sperre ab', async () => {
    const harness = await setup();
    const created = await anlegen(harness, 'planer');

    const parsed = parseAgentToken(created.token);
    if (parsed === null) throw new Error('Token nicht lesbar');

    // 1. Das Token aus dem Tool ist das Token der Anmeldung.
    const actor = await actorForClient(harness.ctx, parsed.clientId, parsed.secret);
    expect(actor).toEqual({ kind: 'agent', id: 'planer' });

    // 2. Angemeldet heisst nicht berechtigt: Ohne Freigabe sieht er keine App
    //    und darf keinen weiteren Agent anlegen.
    const apps = await runTool(listAppsTool, { ctx: harness.ctx, actor }, {});
    expect(apps.value).toEqual({ apps: [] });
    const zwilling = await runTool(
      createAgentTool,
      { ctx: harness.ctx, actor },
      { name: 'zwilling' },
    );
    expect(zwilling.error?.code).toBe('permission_denied');

    // 3. Ein falsches Secret zur richtigen Id kommt nicht herein.
    await expect(actorForClient(harness.ctx, parsed.clientId, 'falsch')).rejects.toThrow(
      UnauthenticatedError,
    );

    // 4. Sperren — und das unveraenderte Token ist beim naechsten Aufruf wertlos.
    const gesperrt = await runTool(
      disableAgentTool,
      { ctx: harness.ctx, actor: admin },
      { name: 'planer' },
    );
    expect(gesperrt.value).toMatchObject({ disabled: true });
    await expect(actorForClient(harness.ctx, parsed.clientId, parsed.secret)).rejects.toThrow(
      UnauthenticatedError,
    );
  });

  it('laesst einen Agent mit agent:* weitere Agents anlegen — Grundsatz 1', async () => {
    const harness = await setup();
    await anlegen(harness, 'verwalter');
    const verwalter: Actor = { kind: 'agent', id: 'verwalter' };
    for (const verb of ['read', 'write'] as const) {
      await grant(harness.ctx, {
        actor: admin,
        subject: verwalter,
        verb,
        resource: { kind: 'agent', id: '*' },
      });
    }

    const neu = await runTool(
      createAgentTool,
      { ctx: harness.ctx, actor: verwalter },
      { name: 'helfer' },
    );
    expect(neu.ok).toBe(true);

    const liste = await runTool(listAgentsTool, { ctx: harness.ctx, actor: verwalter }, {});
    const namen = (liste.value as { agents: { name: string }[] }).agents.map((a) => a.name);
    expect(namen).toEqual(['helfer', 'verwalter']);
    // Wem der neue Agent gehoert, steht dabei — auch wenn ein Agent ihn anlegte.
    expect((neu.value as CreatedAgentIdentity).agent.ownerUserId).toBe('agent:verwalter');
  });
});

describe('Ohne Freigabe', () => {
  it('gibt permission_denied zurueck und zeigt eine leere Liste', async () => {
    const harness = await setup();
    await anlegen(harness, 'planer');

    const versuch = await runTool(
      disableAgentTool,
      { ctx: harness.ctx, actor: fremd },
      { name: 'planer' },
    );
    expect(versuch.error?.code).toBe('permission_denied');

    const liste = await runTool(listAgentsTool, { ctx: harness.ctx, actor: fremd }, {});
    expect(liste.value).toEqual({ agents: [] });
  });

  it('protokolliert eine ungueltige Eingabe, statt sie zu verschlucken', async () => {
    const harness = await setup();
    const result = await runTool(createAgentTool, { ctx: harness.ctx, actor: admin }, {});
    expect(result.error?.code).toBe('validation_failed');
    expect(harness.store.auditEntries.at(-1)?.action).toBe('create_agent');
  });
});
