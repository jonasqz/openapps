/**
 * Freigaben an eine App als Subjekt ueber das MCP-Tool `grant` (ADR 0020):
 * Agents first — eine App bekommt ihr Recht, ein Tool einer anderen App
 * aufzurufen, ueber denselben Weg wie jedes andere Recht. Default-Deny:
 * Ohne `grant` darf die App nichts, und wer selbst kein `write` auf die
 * Ziel-App hat, kann es ihr nicht geben.
 */

import { describe, expect, it } from 'vitest';
import { can, createApp } from '@openapps/control-plane/domain';
import type { Actor, AppManifest } from '@openapps/control-plane/domain';
import { grantTool, runTool } from '../src/tools';
import { admin, createHarness, seedBootstrapGrants } from './helpers';

const manifestFor = (name: string, tool: string): AppManifest => ({
  manifestVersion: 1,
  name,
  displayName: name,
  description: `Test-App ${name}`,
  category: 'test',
  version: '1.0.0',
  requiredTables: [],
  offeredTools: [{ name: tool, description: tool, verb: 'write', operationId: tool }],
  requestedGrants: [],
  env: [],
  egress: [],
  source: { git: `https://example.invalid/${name}.git`, tag: 'v1.0.0' },
});

const wiki: Actor = { kind: 'app', id: 'wiki' };
const tool = { kind: 'tool' as const, id: 'knowledge.documents.upsert' };

async function setup() {
  const harness = createHarness();
  await seedBootstrapGrants(harness);
  await createApp(harness.ctx, {
    actor: admin,
    name: 'knowledge',
    manifest: manifestFor('knowledge', 'documents.upsert'),
  });
  await createApp(harness.ctx, {
    actor: admin,
    name: 'wiki',
    manifest: manifestFor('wiki', 'pages.list'),
  });
  return harness;
}

describe('grant mit subjectKind app', () => {
  it('ohne Freigabe darf die App das Tool nicht ausfuehren', async () => {
    const harness = await setup();
    expect(await can(harness.ctx, wiki, 'execute', tool)).toBe(false);
  });

  it('ein Administrator gibt der App execute auf ein Tool einer anderen App', async () => {
    const harness = await setup();
    const result = await runTool(
      grantTool,
      { ctx: harness.ctx, actor: admin },
      {
        subjectKind: 'app',
        subjectId: 'wiki',
        verb: 'execute',
        resourceKind: 'tool',
        resourceId: 'knowledge.documents.upsert',
      },
    );
    expect(result.ok).toBe(true);
    expect(await can(harness.ctx, wiki, 'execute', tool)).toBe(true);
    // Nur dieses Tool, nicht die ganze App.
    expect(await can(harness.ctx, wiki, 'execute', { kind: 'tool', id: 'knowledge.search' })).toBe(
      false,
    );
  });

  it('ein Agent ohne write auf die Ziel-App kann der App nichts geben', async () => {
    const harness = await setup();
    const result = await runTool(
      grantTool,
      { ctx: harness.ctx, actor: { kind: 'agent', id: 'praktikant' } },
      {
        subjectKind: 'app',
        subjectId: 'wiki',
        verb: 'execute',
        resourceKind: 'tool',
        resourceId: 'knowledge.documents.upsert',
      },
    );
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('permission_denied');
    expect(await can(harness.ctx, wiki, 'execute', tool)).toBe(false);
  });
});
