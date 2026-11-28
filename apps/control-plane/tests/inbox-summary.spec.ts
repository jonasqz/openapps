/**
 * ADR 0024 Schritt 6 (ADR 0022 Schritt 7): Zusammenfassung im Home.
 *
 * - Ohne Modell `not_configured`, kein Aufruf.
 * - Nur Eintraege aus Apps, die die Person jetzt lesen darf.
 * - Lokale Apps bei externem Anbieter: zurueckgehalten, im Audit ohne Inhalt.
 * - Die Nutzung zaehlt auf die Person, Zweck `summary`.
 */

import { describe, expect, it } from 'vitest';
import {
  createApp,
  emitEvent,
  grant,
  NotConfiguredError,
  revoke,
  summarizeInbox,
  type Actor,
  type AppManifest,
  type Grant,
  type ModelSetup,
} from '../src/domain';
import {
  createScriptedModelProvider,
  scriptedModelSetup,
  type ScriptedModelProvider,
} from '../src/infra/memory/doubles';
import { admin, createHarness, manifest, seedBootstrapGrants, type Harness } from './helpers';

const ben = { id: 'u-ben', email: 'ben@example.com', name: 'Ben' };
const asBen: Actor = { kind: 'user', id: ben.id, groups: [] };

function withEvent(name: string, type: string): AppManifest {
  return { ...manifest(name), events: [{ type, description: 'Something.', importance: 'high' }] };
}

async function fixture(models?: ModelSetup): Promise<{ harness: Harness; crmRead: Grant }> {
  const harness = createHarness({
    appsDomain: 'apps.example.com',
    ...(models === undefined ? {} : { models }),
  });
  await seedBootstrapGrants(harness);
  harness.store.users.add(ben);
  const ctx = harness.ctx;
  await createApp(ctx, {
    actor: admin,
    name: 'tasks',
    manifest: withEvent('tasks', 'task.assigned'),
  });
  await createApp(ctx, { actor: admin, name: 'crm', manifest: withEvent('crm', 'deal.won') });
  let crmRead: Grant | undefined;
  for (const app of ['tasks', 'crm']) {
    await grant(ctx, {
      actor: admin,
      subject: { kind: 'app', id: app },
      verb: 'execute',
      resource: { kind: 'tool', id: 'platform.emit_event' },
    });
    const read = await grant(ctx, {
      actor: admin,
      subject: asBen,
      verb: 'read',
      resource: { kind: 'app', id: app },
    });
    if (app === 'crm') crmRead = read;
  }
  const at = new Date(Date.now() - 60_000).toISOString();
  await emitEvent(ctx, {
    actor: { kind: 'app', id: 'tasks' },
    args: {
      id: 't1',
      type: 'task.assigned',
      object: 'tasks:task:1',
      title: 'Review the budget',
      path: '/task/1',
      audience: ['human:ben@example.com'],
      occurredAt: at,
    },
  });
  await emitEvent(ctx, {
    actor: { kind: 'app', id: 'crm' },
    args: {
      id: 'd1',
      type: 'deal.won',
      object: 'crm:deal:1',
      title: 'Acme deal won',
      path: '/deals/1',
      audience: ['human:ben@example.com'],
      occurredAt: at,
    },
  });
  return { harness, crmRead: crmRead! };
}

const sentText = (provider: ScriptedModelProvider) => JSON.stringify(provider.chats);

describe('summarizeInbox', () => {
  it('ohne Modell not_configured', async () => {
    const { harness } = await fixture();
    await expect(
      summarizeInbox(harness.ctx, { actor: asBen, email: ben.email }),
    ).rejects.toBeInstanceOf(NotConfiguredError);
  });

  it('fasst nur Titel aus lesbaren Apps zusammen; die Nutzung zaehlt auf die Person', async () => {
    const provider = createScriptedModelProvider({
      replies: [{ text: '- Review the budget first.' }],
    });
    const { harness, crmRead } = await fixture(scriptedModelSetup(provider));
    await revoke(harness.ctx, { actor: admin, grantId: crmRead.id });
    const result = await summarizeInbox(harness.ctx, { actor: asBen, email: ben.email });
    expect(result).toEqual({ summary: '- Review the budget first.', items: 1, withheld: 0 });
    expect(sentText(provider)).toContain('Review the budget');
    expect(sentText(provider)).not.toContain('Acme');
    expect(harness.store.modelUsage.rows.at(-1)).toMatchObject({
      subject: { kind: 'user', id: 'u-ben' },
      purpose: 'summary',
    });
    expect(JSON.stringify(harness.store.auditEntries)).not.toContain('Review the budget');
  });

  it('externer Anbieter: Eintraege lokaler Apps bleiben draussen, im Audit ohne Inhalt', async () => {
    const provider = createScriptedModelProvider({ local: false });
    const { harness } = await fixture(scriptedModelSetup(provider, { localOnlyApps: ['crm'] }));
    const result = await summarizeInbox(harness.ctx, { actor: asBen, email: ben.email });
    expect(result).toMatchObject({ items: 1, withheld: 1 });
    expect(sentText(provider)).not.toContain('Acme');
    const withheld = harness.store.auditEntries.find((entry) => entry.action === 'model_withheld');
    expect(withheld).toMatchObject({ detail: { apps: ['crm'], count: 1, purpose: 'summary' } });
    expect(JSON.stringify(withheld)).not.toContain('Acme');
  });

  it('nichts Erlaubtes: kein Aufruf, leere Zusammenfassung', async () => {
    const provider = createScriptedModelProvider({ local: false });
    const { harness } = await fixture(
      scriptedModelSetup(provider, { localOnlyApps: ['crm', 'tasks'] }),
    );
    expect(await summarizeInbox(harness.ctx, { actor: asBen, email: ben.email })).toEqual({
      summary: null,
      items: 0,
      withheld: 2,
    });
    expect(provider.chats).toHaveLength(0);
  });
});
