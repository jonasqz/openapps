/**
 * ADR 0024 Schritt 5: Team-Gedaechtnis.
 *
 * Die riskanten Pfade zuerst:
 *
 * - Ein Eintrag aus einem Lauf mit CRM-Tools ist fuer einen Aufrufer ohne
 *   `read` auf dem CRM unsichtbar, auch fuer einen Lauf, den so jemand startet.
 * - Der Agent kann die Herkunft nicht verkleinern, nur vergroessern, und nur
 *   um Apps, die er lesen darf.
 * - Ein externer Agent: Herkunft sind alle Apps, die er lesen darf.
 * - Bei externem Anbieter sieht ein Lauf keine Eintraege mit lokaler Herkunft.
 * - `forget` loescht hart, nur fuer den Autor oder wer den Agenten pflegt.
 * - Ohne Freigabe nichts.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  contextForRun,
  createAgentIdentity,
  createApp,
  forget,
  grant,
  listMemories,
  NotFoundError,
  PermissionDeniedError,
  recall,
  remember,
  revoke,
  ValidationError,
  type Actor,
  type AgentRun,
  type DomainContext,
  type Grant,
  type ModelSetup,
} from '../src/domain';
import { createScriptedModelProvider, scriptedModelSetup } from '../src/infra/memory/doubles';
import { admin, createHarness, manifest, seedBootstrapGrants, type Harness } from './helpers';

const helper: Actor = { kind: 'agent', id: 'helper' };
const scout: Actor = { kind: 'agent', id: 'scout' };
const anna: Actor = { kind: 'user', id: 'u-anna', groups: [] };
const ben: Actor = { kind: 'user', id: 'u-ben', groups: [] };

interface Fixture {
  readonly harness: Harness;
  readonly ctx: DomainContext;
  readonly scoutCrm: Grant;
}

async function fixture(models?: ModelSetup): Promise<Fixture> {
  const harness = createHarness(models === undefined ? {} : { models });
  await seedBootstrapGrants(harness);
  const ctx = harness.ctx;
  for (const name of ['crm', 'wiki']) {
    await createApp(ctx, { actor: admin, name, manifest: manifest(name) });
  }
  await createAgentIdentity(ctx, { actor: admin, name: 'helper' });
  await createAgentIdentity(ctx, { actor: admin, name: 'scout' });
  const give = (
    subject: Actor,
    verb: 'read' | 'execute' | 'write',
    kind: 'app' | 'tool' | 'agent',
    id: string,
  ) => grant(ctx, { actor: admin, subject, verb, resource: { kind, id } });
  for (const agent of [helper, scout]) {
    await give(agent, 'execute', 'tool', 'platform.remember');
    await give(agent, 'execute', 'tool', 'platform.recall');
    await give(agent, 'read', 'app', 'wiki');
  }
  await give(helper, 'read', 'app', 'crm');
  const scoutCrm = await give(scout, 'read', 'app', 'crm');
  await give(anna, 'read', 'app', 'wiki');
  await give(anna, 'execute', 'tool', 'platform.recall');
  await give(ben, 'read', 'app', 'wiki');
  await give(ben, 'read', 'app', 'crm');
  await give(ben, 'execute', 'tool', 'platform.recall');
  return { harness, ctx, scoutCrm };
}

const runScope = (usedApps: string[]) => ({
  runId: '00000000-0000-4000-8000-00000000abcd',
  usedApps: () => usedApps,
});

describe('Herkunft und Sichtbarkeit', () => {
  let f: Fixture;
  beforeEach(async () => {
    f = await fixture();
  });

  it('ein Eintrag aus einem Lauf mit CRM ist fuer Anna (ohne CRM) unsichtbar, fuer Ben sichtbar', async () => {
    const entry = await remember(f.ctx, {
      actor: helper,
      text: 'Acme renews in March',
      run: runScope(['crm', 'wiki']),
    });
    expect(entry.apps).toEqual(['crm', 'wiki']);
    expect(entry.runId).toBe('00000000-0000-4000-8000-00000000abcd');
    expect((await recall(f.ctx, { actor: anna, query: 'Acme' })).memories).toEqual([]);
    expect((await recall(f.ctx, { actor: ben, query: 'Acme' })).memories.map((m) => m.id)).toEqual([
      entry.id,
    ]);
    // Im Audit steht kein Text.
    expect(JSON.stringify(f.harness.store.auditEntries)).not.toContain('Acme');
  });

  it('der Agent kann die Herkunft nicht verkleinern; eine Angabe vergroessert sie nur', async () => {
    const entry = await remember(f.ctx, {
      actor: helper,
      text: 'Only from the wiki, honestly',
      apps: [],
      run: runScope(['crm']),
    });
    expect(entry.apps).toEqual(['crm']);
    const larger = await remember(f.ctx, {
      actor: helper,
      text: 'Wiki and CRM',
      apps: ['wiki'],
      run: runScope(['crm']),
    });
    expect(larger.apps).toEqual(['crm', 'wiki']);
  });

  it('eine Angabe nur um Apps, die der Agent lesen darf', async () => {
    await createApp(f.ctx, { actor: admin, name: 'hr-files', manifest: manifest('hr-files') });
    await expect(
      remember(f.ctx, { actor: helper, text: 'x', apps: ['hr-files'], run: runScope([]) }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('ein externer Agent: Herkunft sind alle Apps, die er lesen darf', async () => {
    const entry = await remember(f.ctx, { actor: scout, text: 'Note from outside' });
    expect(entry.apps).toEqual(['crm', 'wiki']);
    expect((await recall(f.ctx, { actor: anna, query: 'outside' })).memories).toEqual([]);
  });

  it('ein Widerruf wirkt beim naechsten Aufruf', async () => {
    await remember(f.ctx, { actor: helper, text: 'Acme note', run: runScope(['crm']) });
    expect((await recall(f.ctx, { actor: scout, query: 'Acme' })).memories).toHaveLength(1);
    await revoke(f.ctx, { actor: admin, grantId: f.scoutCrm.id });
    expect((await recall(f.ctx, { actor: scout, query: 'Acme' })).memories).toEqual([]);
  });

  it('ein Lauf, den Anna startet, sieht die CRM-Eintraege nicht, auch wenn der Agent das CRM liest', async () => {
    await remember(f.ctx, { actor: helper, text: 'Acme renews', run: runScope(['crm']) });
    await remember(f.ctx, { actor: helper, text: 'Acme wiki page', run: runScope(['wiki']) });
    const run = {
      agentName: 'helper',
      trigger: { kind: 'user', id: 'u-anna', email: 'anna@example.com' },
    } as AgentRun;
    const runCtx = contextForRun(f.ctx, run);
    const seen = (await recall(runCtx, { actor: helper, query: 'Acme' })).memories.map(
      (m) => m.text,
    );
    expect(seen).toEqual(['Acme wiki page']);
    // Der Agent selbst (ueber /mcp) sieht beide.
    expect((await recall(f.ctx, { actor: helper, query: 'Acme' })).memories).toHaveLength(2);
  });

  it('bei externem Anbieter gibt das Gedaechtnis Eintraege lokaler Herkunft nicht an den Lauf', async () => {
    const g = await fixture(
      scriptedModelSetup(createScriptedModelProvider({ local: false }), { localOnlyApps: ['crm'] }),
    );
    await remember(g.ctx, { actor: helper, text: 'Acme renews', run: runScope(['crm']) });
    const run = {
      agentName: 'helper',
      trigger: { kind: 'user', id: 'u-ben', email: 'ben@example.com' },
    } as AgentRun;
    expect(
      (await recall(contextForRun(g.ctx, run), { actor: helper, query: 'Acme' })).memories,
    ).toEqual([]);
    const local = await fixture(
      scriptedModelSetup(createScriptedModelProvider({ kind: 'openai-compatible', local: true }), {
        localOnlyApps: ['crm'],
      }),
    );
    await remember(local.ctx, { actor: helper, text: 'Acme renews', run: runScope(['crm']) });
    expect(
      (await recall(contextForRun(local.ctx, run), { actor: helper, query: 'Acme' })).memories,
    ).toHaveLength(1);
  });
});

describe('Freigaben', () => {
  it('ohne remember- bzw. recall-Freigabe 403; Menschen merken sich nichts', async () => {
    const f = await fixture();
    await createAgentIdentity(f.ctx, { actor: admin, name: 'nobody' });
    const nobody: Actor = { kind: 'agent', id: 'nobody' };
    await expect(remember(f.ctx, { actor: nobody, text: 'x' })).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
    await expect(recall(f.ctx, { actor: nobody, query: 'xx' })).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
    await expect(remember(f.ctx, { actor: ben, text: 'x' })).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
    await expect(
      recall(f.ctx, { actor: { kind: 'app', id: 'crm' }, query: 'xx' }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(f.harness.store.auditEntries.at(-1)).toMatchObject({
      action: 'recall',
      outcome: 'denied',
    });
  });

  it('list_memories eines Agenten nur mit write auf ihn, und nur Lesbares', async () => {
    const f = await fixture();
    await remember(f.ctx, { actor: helper, text: 'crm note', run: runScope(['crm']) });
    await remember(f.ctx, { actor: helper, text: 'wiki note', run: runScope(['wiki']) });
    await expect(listMemories(f.ctx, { actor: ben, agent: 'helper' })).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
    await grant(f.ctx, {
      actor: admin,
      subject: anna,
      verb: 'write',
      resource: { kind: 'agent', id: 'helper' },
    });
    expect(
      (await listMemories(f.ctx, { actor: anna, agent: 'helper' })).memories.map((m) => m.text),
    ).toEqual(['wiki note']);
    expect((await listMemories(f.ctx, { actor: helper, agent: 'helper' })).memories).toHaveLength(
      2,
    );
  });
});

describe('forget', () => {
  it('loescht hart; nur der Autor oder wer den Agenten pflegt; nur Sichtbares', async () => {
    const f = await fixture();
    const entry = await remember(f.ctx, {
      actor: helper,
      text: 'wiki note',
      run: runScope(['wiki']),
    });
    await expect(forget(f.ctx, { actor: scout, id: entry.id })).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
    await expect(forget(f.ctx, { actor: ben, id: entry.id })).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
    expect(await forget(f.ctx, { actor: helper, id: entry.id })).toEqual({ forgotten: true });
    expect(await f.harness.store.memories.findById(entry.id)).toBeNull();
    expect(f.harness.store.memories.entries()).toHaveLength(0);

    const crm = await remember(f.ctx, { actor: helper, text: 'crm note', run: runScope(['crm']) });
    await grant(f.ctx, {
      actor: admin,
      subject: anna,
      verb: 'write',
      resource: { kind: 'agent', id: 'helper' },
    });
    // Anna pflegt helper, liest aber das CRM nicht: Fuer sie gibt es den Eintrag nicht.
    await expect(forget(f.ctx, { actor: anna, id: crm.id })).rejects.toBeInstanceOf(NotFoundError);
    expect(await forget(f.ctx, { actor: admin, id: crm.id })).toEqual({ forgotten: true });
  });
});
