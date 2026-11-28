/**
 * `list_inbox` und `mark_inbox` (ADR 0022 D): der Eingang eines Agenten.
 * Riskant: ein Agent, der Benachrichtigungen einer App sieht, die er nicht
 * (mehr) lesen darf, oder Zeilen eines anderen Eingangs markiert.
 */

import { describe, expect, it } from 'vitest';
import {
  createAgentIdentity,
  createApp,
  emitEvent,
  grant,
  revoke,
  type Actor,
  type AppManifest,
  type DomainContext,
  type InboxResult,
} from '@openapps/control-plane/domain';
import { listInboxTool, markInboxTool, platformTools, runTool } from '../src/tools';
import { admin, createHarness, seedBootstrapGrants } from './helpers';

const tasks: AppManifest = {
  manifestVersion: 1,
  name: 'tasks',
  displayName: 'Tasks',
  description: 'Test-App tasks',
  category: 'test',
  version: '1.0.0',
  requiredTables: [],
  offeredTools: [],
  requestedGrants: [],
  env: [],
  egress: [],
  events: [{ type: 'task.assigned', description: 'Assigned.', importance: 'high' }],
  source: { git: 'https://example.invalid/tasks.git', tag: 'v1.0.0' },
};

const helper: Actor = { kind: 'agent', id: 'helper' };
const other: Actor = { kind: 'agent', id: 'other' };

async function setup(): Promise<{ ctx: DomainContext; readGrant: string }> {
  const harness = createHarness();
  await seedBootstrapGrants(harness);
  const ctx: DomainContext = { ...harness.ctx, appsDomain: 'apps.example.com' };
  await createAgentIdentity(ctx, { actor: admin, name: 'helper' });
  await createAgentIdentity(ctx, { actor: admin, name: 'other' });
  await createApp(ctx, { actor: admin, name: 'tasks', manifest: tasks });
  await grant(ctx, {
    actor: admin,
    subject: { kind: 'app', id: 'tasks' },
    verb: 'execute',
    resource: { kind: 'tool', id: 'platform.emit_event' },
  });
  const read = await grant(ctx, {
    actor: admin,
    subject: helper,
    verb: 'read',
    resource: { kind: 'app', id: 'tasks' },
  });
  await grant(ctx, {
    actor: admin,
    subject: other,
    verb: 'read',
    resource: { kind: 'app', id: 'tasks' },
  });
  await emitEvent(ctx, {
    actor: { kind: 'app', id: 'tasks' },
    args: {
      id: 'a1',
      type: 'task.assigned',
      object: 'task:1',
      title: 'Assigned to you: Triage',
      path: '/task/1',
      audience: ['agent:helper', 'agent:other'],
    },
  });
  return { ctx, readGrant: read.id };
}

describe('list_inbox und mark_inbox', () => {
  it('stehen unter den Plattform-Tools, in snake_case', () => {
    const names = platformTools.map((tool) => tool.name);
    expect(names).toContain('list_inbox');
    expect(names).toContain('mark_inbox');
  });

  it('zeigt nur den eigenen Eingang, und ein Widerruf blendet ihn sofort aus', async () => {
    const { ctx, readGrant } = await setup();
    const first = await runTool(listInboxTool, { ctx, actor: helper }, {});
    expect(first.ok).toBe(true);
    const inbox = first.value as InboxResult;
    expect(inbox.items.map((item) => item.title)).toEqual(['Assigned to you: Triage']);
    expect(inbox.items[0]?.href).toBe('https://apps.example.com/tasks/task/1');

    await revoke(ctx, { actor: admin, grantId: readGrant });
    const after = (await runTool(listInboxTool, { ctx, actor: helper }, {})).value as InboxResult;
    expect(after.items).toEqual([]);
  });

  it('markiert keine Zeile eines anderen Eingangs', async () => {
    const { ctx } = await setup();
    const mine = ((await runTool(listInboxTool, { ctx, actor: helper }, {})).value as InboxResult)
      .items[0];
    const result = await runTool(
      markInboxTool,
      { ctx, actor: other },
      {
        ids: [mine?.id],
        state: 'done',
      },
    );
    expect(result).toEqual({ ok: true, value: { updated: 0 } });
    const still = (await runTool(listInboxTool, { ctx, actor: helper }, {})).value as InboxResult;
    expect(still.items[0]?.state).toBe('unread');

    const own = await runTool(
      markInboxTool,
      { ctx, actor: helper },
      {
        ids: [mine?.id],
        state: 'done',
      },
    );
    expect(own).toEqual({ ok: true, value: { updated: 1 } });
  });

  it('weist falsche Eingaben ab und protokolliert sie', async () => {
    const { ctx } = await setup();
    const bad = await runTool(listInboxTool, { ctx, actor: helper }, { state: 'everything' });
    expect(bad.ok).toBe(false);
    expect(bad.error?.code).toBe('validation_failed');
    const none = await runTool(markInboxTool, { ctx, actor: helper }, { ids: [], state: 'read' });
    expect(none.ok).toBe(false);
  });
});
