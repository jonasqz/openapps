/**
 * Die Gruppenpflege als MCP-Tool — Grundsatz 1 aus CLAUDE.md: Jede Aktion
 * existiert als API **und** als Tool, bevor sie einen Button bekommt.
 *
 * Geprueft wird deshalb nicht die Domaenenlogik (das tut
 * `apps/control-plane/tests/groups.spec.ts`), sondern der Weg durch `runTool`:
 * Sind die Tools da, kommt eine Ablehnung als Fehler mit Code zurueck statt
 * als Ausnahme, und bleibt die Eingabepruefung an der Stelle, an der sie den
 * Audit-Eintrag noch schreiben kann.
 */

import { describe, expect, it } from 'vitest';
import { grant } from '@openapps/control-plane/domain';
import type { Actor } from '@openapps/control-plane/domain';
import {
  createGroupTool,
  grantGroupMemberTool,
  listGroupMembersTool,
  listGroupsTool,
  platformTools,
  revokeGroupMemberTool,
  runTool,
} from '../src/tools';
import { admin, createHarness, seedBootstrapGrants, type Harness } from './helpers';

const fremd: Actor = { kind: 'user', id: 'u-niemand', groups: [] };
/** Ein Agent. Er darf Gruppen pflegen — genau das soll moeglich sein. */
const agent: Actor = { kind: 'agent', id: 'personalpflege' };

async function setup(): Promise<Harness> {
  const harness = createHarness();
  await seedBootstrapGrants(harness);
  return harness;
}

describe('Gruppen-Tools gibt es und sie heissen wie die Aktionen', () => {
  it('fuehrt alle fuenf in platformTools', () => {
    const namen = platformTools.map((tool) => tool.name);
    expect(namen).toContain('list_groups');
    expect(namen).toContain('create_group');
    expect(namen).toContain('list_group_members');
    expect(namen).toContain('grant_group_member');
    expect(namen).toContain('revoke_group_member');
  });

  it('nennt kein Tool zweimal — sonst gewinnt am Transport ein beliebiges', () => {
    const namen = platformTools.map((tool) => tool.name);
    expect(new Set(namen).size).toBe(namen.length);
  });
});

describe('Ein Agent kann eine Gruppe pflegen, wenn er darf', () => {
  it('legt an, nimmt auf, liest und entfernt', async () => {
    const harness = await setup();
    const call = { ctx: harness.ctx, actor: agent };

    // Der Agent bekommt die Wildcard — ohne sie darf er nicht anlegen.
    for (const verb of ['read', 'write'] as const) {
      await grant(harness.ctx, {
        actor: admin,
        subject: { kind: 'agent', id: agent.id },
        verb,
        resource: { kind: 'group', id: '*' },
      });
    }

    const angelegt = await runTool(createGroupTool, call, {
      name: 'marketing',
      description: 'Marketing',
    });
    expect(angelegt.ok).toBe(true);

    const aufgenommen = await runTool(grantGroupMemberTool, call, {
      group: 'marketing',
      email: 'Lena@Example.com',
    });
    expect(aufgenommen.ok).toBe(true);
    expect(aufgenommen.value).toEqual({
      group: 'marketing',
      email: 'lena@example.com',
      added: true,
    });

    const mitglieder = await runTool(listGroupMembersTool, call, { group: 'marketing' });
    expect(mitglieder.ok).toBe(true);

    const gruppen = await runTool(listGroupsTool, call, {});
    expect(gruppen.ok).toBe(true);

    const entfernt = await runTool(revokeGroupMemberTool, call, {
      group: 'marketing',
      email: 'lena@example.com',
    });
    expect(entfernt.value).toMatchObject({ removed: true });
  });
});

describe('Ohne Freigabe kommt ein Fehler mit Code, keine Ausnahme', () => {
  it('gibt permission_denied zurueck und veraendert nichts', async () => {
    const harness = await setup();
    await runTool(createGroupTool, { ctx: harness.ctx, actor: admin }, { name: 'marketing' });

    const versuch = await runTool(
      grantGroupMemberTool,
      { ctx: harness.ctx, actor: fremd },
      { group: 'marketing', email: 'wer@example.com' },
    );

    expect(versuch.ok).toBe(false);
    expect(versuch.error?.code).toBe('permission_denied');
    expect(await harness.ctx.groups.listMembers('marketing')).toHaveLength(0);
  });

  it('protokolliert eine fehlende Eingabe, bevor die Domaene sie sieht', async () => {
    const harness = await setup();

    const versuch = await runTool(
      grantGroupMemberTool,
      { ctx: harness.ctx, actor: admin },
      { group: 'marketing' },
    );

    expect(versuch.ok).toBe(false);
    expect(versuch.error?.code).toBe('validation_failed');
    const letzter = harness.store.auditEntries.at(-1);
    expect(letzter?.action).toBe('grant_group_member');
    expect(letzter?.outcome).toBe('error');
  });
});
