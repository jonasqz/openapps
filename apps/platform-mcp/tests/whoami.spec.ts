/**
 * `whoami` (ADR 0017): Ein Agent soll nachsehen koennen, wer er ist und was er
 * darf, ohne dafuer ein Recht zu brauchen. Riskant ist das Gegenteil: dass er
 * dabei fremde Freigaben oder Apps sieht, die er nicht lesen darf.
 */

import { describe, expect, it } from 'vitest';
import {
  createAgentIdentity,
  createApp,
  grant,
  type ActorDescription,
  type Actor,
  type AppManifest,
  type DomainContext,
} from '@openapps/control-plane/domain';
import { platformTools, runTool, whoamiTool } from '../src/tools';
import { admin, createHarness, seedBootstrapGrants, type Harness } from './helpers';

const manifestFor = (name: string): AppManifest => ({
  manifestVersion: 1,
  name,
  displayName: name,
  description: `Test-App ${name}`,
  category: 'test',
  version: '1.0.0',
  requiredTables: [],
  offeredTools: [],
  requestedGrants: [],
  env: [],
  egress: [],
  source: { git: `https://example.invalid/${name}.git`, tag: 'v1.0.0' },
});

const praktikant: Actor = { kind: 'agent', id: 'praktikant' };

async function setup(): Promise<DomainContext> {
  return (await setupHarness()).ctx;
}

async function setupHarness(): Promise<Harness & { readonly ctx: DomainContext }> {
  const harness = createHarness();
  await seedBootstrapGrants(harness);
  // Ohne Domain stuende keine App in der Liste; die MCP-Huelle setzt keine.
  const ctx: DomainContext = { ...harness.ctx, appsDomain: 'apps.example.com' };
  await createAgentIdentity(ctx, { actor: admin, name: 'praktikant', displayName: 'Intern' });
  await createAgentIdentity(ctx, { actor: admin, name: 'vertrieb' });
  await createApp(ctx, { actor: admin, name: 'wiki', manifest: manifestFor('wiki') });
  await createApp(ctx, { actor: admin, name: 'crm', manifest: manifestFor('crm') });
  await grant(ctx, {
    actor: admin,
    subject: praktikant,
    verb: 'read',
    resource: { kind: 'app', id: 'wiki' },
  });
  await grant(ctx, {
    actor: admin,
    subject: { kind: 'agent', id: 'vertrieb' },
    verb: 'read',
    resource: { kind: 'app', id: 'crm' },
  });
  // Eine Gruppen-Freigabe: Ein Agent ist in keiner Gruppe, sie darf bei ihm
  // nie auftauchen.
  await grant(ctx, {
    actor: admin,
    subject: { kind: 'group', id: 'team' },
    verb: 'read',
    resource: { kind: 'app', id: 'crm' },
  });
  return { ...harness, ctx };
}

describe('whoami', () => {
  it('steht in platformTools', () => {
    const namen = platformTools.map((tool) => tool.name);
    expect(namen).toContain('whoami');
    expect(new Set(namen).size).toBe(namen.length);
  });

  it('zeigt einem Agent ohne Admin-Recht nur sich selbst, seine Apps und Freigaben', async () => {
    const ctx = await setup();
    const result = await runTool(whoamiTool, { ctx, actor: praktikant }, {});
    expect(result.ok).toBe(true);
    const { me } = result.value as { me: ActorDescription };
    expect(me).toMatchObject({
      kind: 'agent',
      id: 'praktikant',
      email: null,
      groups: [],
      isAdmin: false,
      canCreateApps: false,
      agent: { name: 'praktikant', displayName: 'Intern', ownerUserId: 'user:u-admin' },
    });
    expect(me.apps.map((app) => app.name)).toEqual(['wiki']);
    expect(me.grants.map((g) => `${g.subject.id}:${g.resource.id}`)).toEqual(['praktikant:wiki']);
    expect(me.grants[0]?.via).toEqual({ kind: 'direct' });
  });

  it('zeigt einem Menschen Freigaben ueber seine Gruppe mit Herkunft, keine fremden', async () => {
    const ctx = await setup();
    const lena: Actor = { kind: 'user', id: 'u-lena', groups: ['team'] };
    const result = await runTool(whoamiTool, { ctx, actor: lena }, {});
    expect(result.ok).toBe(true);
    const { me } = result.value as { me: ActorDescription };
    expect(me.grants.map((g) => ({ resource: g.resource.id, via: g.via }))).toEqual([
      { resource: 'crm', via: { kind: 'group', group: 'team' } },
    ]);
    expect(me.apps.map((app) => app.name)).toEqual(['crm']);
  });

  it('protokolliert den Aufruf als whoami, nicht als list_grants', async () => {
    const { ctx, store } = await setupHarness();
    const before = store.auditEntries.length;
    const result = await runTool(
      whoamiTool,
      { ctx, actor: praktikant, correlationId: 'mcp-session-1' },
      {},
    );
    expect(result.ok).toBe(true);
    const added = store.auditEntries.slice(before);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      actor: { kind: 'agent', id: 'praktikant' },
      action: 'whoami',
      outcome: 'allowed',
      correlationId: 'mcp-session-1',
    });
  });

  it('liefert einem Agent ganz ohne Freigabe leere Listen statt eines Fehlers', async () => {
    const ctx = await setup();
    const fremder: Actor = { kind: 'agent', id: 'unbekannt' };
    const result = await runTool(whoamiTool, { ctx, actor: fremder }, {});
    expect(result.ok).toBe(true);
    const { me } = result.value as { me: ActorDescription };
    expect(me.apps).toEqual([]);
    expect(me.grants).toEqual([]);
    expect(me.agent).toBeNull();
  });

  it('meldet einen Admin als Admin, der Apps anlegen darf', async () => {
    const ctx = await setup();
    const result = await runTool(whoamiTool, { ctx, actor: admin }, {});
    const { me } = result.value as { me: ActorDescription };
    expect(me.isAdmin).toBe(true);
    expect(me.canCreateApps).toBe(true);
    expect(me.apps.map((app) => app.name).sort()).toEqual(['crm', 'wiki']);
  });
});
