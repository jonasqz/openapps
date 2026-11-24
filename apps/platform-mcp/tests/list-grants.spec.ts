/**
 * `list_grants` ohne Angabe liefert die eigenen Freigaben — so steht es in der
 * Beschreibung, die ein Agent liest. Im zweiten Agent-Lauf (ADR 0011) bekam
 * der Praktikant dafuer `permission_denied`: Das Tool fiel ohne Angabe in
 * "alle Freigaben" und verlangte Admin-Rechte.
 */

import { describe, expect, it } from 'vitest';
import { createApp, grant } from '@openapps/control-plane/domain';
import type { Actor, AppManifest } from '@openapps/control-plane/domain';
import { listGrantsTool, runTool } from '../src/tools';
import { admin, createHarness, seedBootstrapGrants } from './helpers';

const praktikant: Actor = { kind: 'agent', id: 'praktikant' };
const andere: Actor = { kind: 'agent', id: 'vertrieb' };

const manifestFor = (name: string, tool: string): AppManifest => ({
  manifestVersion: 1,
  name,
  displayName: name,
  description: `Test-App ${name}`,
  category: 'test',
  version: '1.0.0',
  requiredTables: [],
  offeredTools: [{ name: tool, description: tool, verb: 'read', operationId: tool }],
  requestedGrants: [],
  env: [],
  egress: [],
  source: { git: `https://example.invalid/${name}.git`, tag: 'v1.0.0' },
});

async function setup() {
  const harness = createHarness();
  await seedBootstrapGrants(harness);
  await createApp(harness.ctx, {
    actor: admin,
    name: 'wiki',
    manifest: manifestFor('wiki', 'pages.list'),
  });
  await createApp(harness.ctx, {
    actor: admin,
    name: 'crm',
    manifest: manifestFor('crm', 'deals.list'),
  });
  for (const [subject, id] of [
    [praktikant, 'wiki.pages.list'],
    [andere, 'crm.deals.list'],
  ] as const) {
    await grant(harness.ctx, {
      actor: admin,
      subject,
      verb: 'execute',
      resource: { kind: 'tool', id },
    });
  }
  return harness;
}

type Listed = {
  ok: boolean;
  value?: { grants: { resource: { id: string } }[] };
  error?: { code: string };
};

describe('list_grants', () => {
  it('zeigt einem Agent ohne Angabe genau seine eigenen Freigaben', async () => {
    const harness = await setup();
    const result = (await runTool(
      listGrantsTool,
      { ctx: harness.ctx, actor: praktikant },
      {},
    )) as Listed;
    expect(result.ok).toBe(true);
    expect(result.value?.grants.map((g) => g.resource.id)).toEqual(['wiki.pages.list']);
  });

  it('verweigert einem Agent ohne Admin-Recht alle Freigaben', async () => {
    const harness = await setup();
    const result = (await runTool(
      listGrantsTool,
      { ctx: harness.ctx, actor: praktikant },
      { all: true },
    )) as Listed;
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('permission_denied');
  });

  it('zeigt einem Admin mit all: true auch fremde Freigaben', async () => {
    const harness = await setup();
    const result = (await runTool(
      listGrantsTool,
      { ctx: harness.ctx, actor: admin },
      { all: true },
    )) as Listed;
    const ids = result.value?.grants.map((g) => g.resource.id) ?? [];
    expect(ids).toEqual(expect.arrayContaining(['wiki.pages.list', 'crm.deals.list']));
  });
});
