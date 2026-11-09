/**
 * Nachweis zu DoD 6: Ein Agent mit eigener Identitaet ruft ueber den
 * Plattform-MCP Tools einer App auf. Er sieht und nutzt nur freigegebene Tools,
 * ohne Freigabe wird er blockiert, und jeder Aufruf wird protokolliert.
 *
 * Der Test fuehrt zwei Agents: einen mit Freigabe und einen ohne. Geprueft wird
 * beides — was er sieht **und** was passiert, wenn er es trotzdem versucht.
 */

import { describe, expect, it } from 'vitest';
import { createApp, grant, revoke } from '@openapps/control-plane/domain';
import { PermissionDeniedError } from '@openapps/control-plane/domain';
import type { Actor, AppManifest } from '@openapps/control-plane/domain';
import { callAppTool, listAppTools } from '../src/app-tools';
import { listAppsTool, runTool } from '../src/tools';
import { hashClientSecret, actorForClient, UnauthenticatedError } from '../src/identity';
import {
  admin,
  createCountingInvoker,
  createHarness,
  seedBootstrapGrants,
  type Harness,
} from './helpers';

const berechtigt: Actor = { kind: 'agent', id: 'planer' };
const unberechtigt: Actor = { kind: 'agent', id: 'neugierig' };

const manifest: AppManifest = {
  manifestVersion: 1,
  name: 'projects',
  displayName: 'Projektliste',
  description: 'Projektliste fuer den Test',
  category: 'test',
  version: '1.0.0',
  requiredTables: [{ name: 'projects', description: 'Projekte' }],
  offeredTools: [
    { name: 'list', description: 'Projekte auflisten', verb: 'read', operationId: 'list' },
    { name: 'delete', description: 'Projekt loeschen', verb: 'write', operationId: 'delete' },
  ],
  requestedGrants: [],
  env: [],
  egress: [],
  source: { git: 'https://example.invalid/projects.git', tag: 'v1.0.0' },
};

describe('Agent sieht nur freigegebene Tools', () => {
  it('zeigt dem Agent mit Freigabe genau das freigegebene Tool und dem anderen keines', async () => {
    const harness = await setup();

    await grant(harness.ctx, {
      actor: admin,
      subject: berechtigt,
      verb: 'execute',
      resource: { kind: 'tool', id: 'projects.list' },
    });

    const sichtbar = await listAppTools(harness.ctx, berechtigt);
    expect(sichtbar.map((t) => t.resourceId)).toEqual(['projects.list']);
    // `projects.delete` ist nicht freigegeben und taucht nicht auf.
    expect(sichtbar.map((t) => t.toolName)).not.toContain('delete');

    expect(await listAppTools(harness.ctx, unberechtigt)).toHaveLength(0);
  });
});

describe('Agent ohne Freigabe wird blockiert, nicht nur nicht beliefert', () => {
  it('laesst den Aufruf des nicht freigegebenen Tools scheitern', async () => {
    const harness = await setup();
    const invoker = createCountingInvoker();

    await grant(harness.ctx, {
      actor: admin,
      subject: berechtigt,
      verb: 'execute',
      resource: { kind: 'tool', id: 'projects.list' },
    });

    // Der berechtigte Agent kommt durch.
    await expect(
      callAppTool(harness.ctx, {
        actor: berechtigt,
        toolResourceId: 'projects.list',
        invoker,
      }),
    ).resolves.toBeDefined();

    // Derselbe Agent auf ein anderes Tool derselben App: blockiert.
    await expect(
      callAppTool(harness.ctx, {
        actor: berechtigt,
        toolResourceId: 'projects.delete',
        invoker,
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    // Der unberechtigte Agent: blockiert, obwohl er das Tool nie angeboten bekam.
    await expect(
      callAppTool(harness.ctx, {
        actor: unberechtigt,
        toolResourceId: 'projects.list',
        invoker,
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    // Weitergeleitet wurde genau ein Aufruf.
    expect(invoker.calls).toEqual([{ appName: 'projects', toolName: 'list', actorId: 'planer' }]);
  });

  it('blockiert sofort nach dem Widerruf', async () => {
    const harness = await setup();
    const invoker = createCountingInvoker();

    const granted = await grant(harness.ctx, {
      actor: admin,
      subject: berechtigt,
      verb: 'execute',
      resource: { kind: 'tool', id: 'projects.list' },
    });

    await expect(
      callAppTool(harness.ctx, { actor: berechtigt, toolResourceId: 'projects.list', invoker }),
    ).resolves.toBeDefined();

    await revoke(harness.ctx, { actor: admin, grantId: granted.id });

    await expect(
      callAppTool(harness.ctx, { actor: berechtigt, toolResourceId: 'projects.list', invoker }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(invoker.calls).toHaveLength(1);
  });
});

describe('jeder Aufruf wird protokolliert, auch der abgelehnte', () => {
  it('schreibt fuer beide Agents einen Eintrag mit Subjekt, Tool und Ergebnis', async () => {
    const harness = await setup();
    const invoker = createCountingInvoker();

    await grant(harness.ctx, {
      actor: admin,
      subject: berechtigt,
      verb: 'execute',
      resource: { kind: 'tool', id: 'projects.list' },
    });

    await callAppTool(harness.ctx, {
      actor: berechtigt,
      toolResourceId: 'projects.list',
      invoker,
      correlationId: 'sitzung-1',
    });
    await callAppTool(harness.ctx, {
      actor: unberechtigt,
      toolResourceId: 'projects.list',
      invoker,
      correlationId: 'sitzung-2',
    }).catch(() => undefined);

    const eintraege = harness.store.auditEntries.filter((e) => e.action === 'call_app_tool');
    expect(eintraege).toHaveLength(2);

    expect(eintraege[0]?.actor).toEqual({ kind: 'agent', id: 'planer' });
    expect(eintraege[0]?.outcome).toBe('allowed');
    expect(eintraege[0]?.resource).toEqual({ kind: 'tool', id: 'projects.list' });
    expect(eintraege[0]?.correlationId).toBe('sitzung-1');

    expect(eintraege[1]?.actor).toEqual({ kind: 'agent', id: 'neugierig' });
    expect(eintraege[1]?.outcome).toBe('denied');
    expect(eintraege[1]?.reason).toContain('darf "projects.list" nicht aufrufen');
    expect(eintraege[1]?.correlationId).toBe('sitzung-2');
  });

  it('protokolliert auch ein Plattform-Tool, das abgelehnt wird', async () => {
    const harness = await setup();

    const result = await runTool(listAppsTool, { ctx: harness.ctx, actor: unberechtigt }, {});

    // list_apps selbst ist nicht gesperrt, liefert aber nichts.
    expect(result.ok).toBe(true);
    const eintraege = harness.store.auditEntries.filter((e) => e.action === 'list_apps');
    expect(eintraege).toHaveLength(1);
    expect(eintraege[0]?.detail.visible).toBe(0);
  });
});

describe('Agent-Identitaet', () => {
  it('erkennt den Agent an seinem OAuth-Client und weist ein falsches Secret ab', async () => {
    const harness = await setup();
    await harness.store.agents.create({
      name: 'planer',
      displayName: 'Planungs-Agent',
      ownerUserId: 'u-admin',
      oauthClientId: 'client-planer',
      oauthClientSecretHash: hashClientSecret('richtig'),
    });

    const actor = await actorForClient(harness.ctx, 'client-planer', 'richtig');
    expect(actor).toEqual({ kind: 'agent', id: 'planer' });

    await expect(actorForClient(harness.ctx, 'client-planer', 'falsch')).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    await expect(
      actorForClient(harness.ctx, 'client-gibtsnicht', 'richtig'),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});

describe('ueber einen echten MCP-Transport', () => {
  // Diese Faelle brauchen einen laufenden Server und einen echten Client.
  it.todo('ein stdio-Client sieht in tools/list nur die freigegebenen App-Tools');
  it.todo('ein HTTP-Client ohne gueltigen OAuth-Client bekommt 401');
  it.todo('how_to_build_app liefert den Inhalt von AGENTS.md ueber prompts/get');
  it.todo('ein zweiter Aufruf nach Widerruf bekommt isError, ohne neuen Verbindungsaufbau');
});

async function setup(): Promise<Harness> {
  const harness = createHarness();
  await seedBootstrapGrants(harness);
  await createApp(harness.ctx, { actor: admin, name: 'projects', manifest });
  return harness;
}
