/**
 * ADR 0025: `platform.model_info` und `onBehalfOf` an `generate`.
 *
 * Riskant zuerst:
 *
 * - Ohne Freigabe auf `embed` oder `generate` gibt es nichts (403, Audit).
 * - Eine Freigabe fuer `embed` nennt nur das Embedding-Modell, nicht das
 *   Chat-Modell, und umgekehrt.
 * - `model_info` ruft kein Modell auf und schreibt keine Nutzung.
 * - Ohne Konfiguration sind beide `null`.
 * - `onBehalfOf` landet im Audit, nicht in der Zaehlung, und eine falsche
 *   Form ist 400.
 */

import {
  appCallSignatureFor,
  CALLER_HEADER,
  CALLER_ISSUED_AT_HEADER,
  CALLER_SIGNATURE_HEADER,
  sha256Hex,
} from '@openapps/sdk';
import { describe, expect, it } from 'vitest';
import {
  appCallSecret,
  callAppTool,
  createApp,
  grant,
  PermissionDeniedError,
  type AppToolInvoker,
  type ModelSetup,
} from '../src/domain';
import { createScriptedModelProvider, scriptedModelSetup } from '../src/infra/memory/doubles';
import { handleAppCall } from '../src/lib/app-call';
import {
  admin,
  createHarness,
  manifest,
  seedBootstrapGrants,
  TEST_MASTER_SECRET,
  type Harness,
} from './helpers';

const noInvoker: AppToolInvoker = {
  async invoke() {
    throw new Error('no app is called for platform tools');
  },
};

async function setup(models?: ModelSetup): Promise<Harness> {
  const harness = createHarness({
    appsDomain: 'apps.example.com',
    ...(models === undefined ? {} : { models }),
  });
  await seedBootstrapGrants(harness);
  for (const name of ['knowledge', 'crm']) {
    await createApp(harness.ctx, { actor: admin, name, manifest: manifest(name) });
  }
  return harness;
}

async function grantTool(harness: Harness, app: string, tool: string): Promise<void> {
  await grant(harness.ctx, {
    actor: admin,
    subject: { kind: 'app', id: app },
    verb: 'execute',
    resource: { kind: 'tool', id: `platform.${tool}` },
  });
}

function signedCall(
  harness: Harness,
  tool: string,
  body: Record<string, unknown>,
  caller = 'knowledge',
): Promise<Response> {
  const text = JSON.stringify(body);
  const issuedAt = String(Math.floor(harness.ctx.clock.now().getTime() / 1000));
  const signature = appCallSignatureFor({
    secret: appCallSecret({ masterSecret: TEST_MASTER_SECRET, appId: caller, generation: 1 }),
    caller,
    app: 'platform',
    tool,
    issuedAt,
    bodySha256: sha256Hex(text),
  });
  const request = new Request(
    `http://openapps-control-plane:3000/api/apps/platform/tools/${tool}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [CALLER_HEADER]: caller,
        [CALLER_ISSUED_AT_HEADER]: issuedAt,
        [CALLER_SIGNATURE_HEADER]: signature,
      },
      body: text,
    },
  );
  return handleAppCall(harness.ctx, noInvoker, request, { app: 'platform', tool });
}

describe('model_info (ADR 0025)', () => {
  it('ohne Freigabe auf embed oder generate 403 mit Audit', async () => {
    const harness = await setup(scriptedModelSetup(createScriptedModelProvider()));
    const response = await signedCall(harness, 'model_info', {});
    expect(response.status).toBe(403);
    expect(harness.store.auditEntries.at(-1)).toMatchObject({
      action: 'model_info',
      outcome: 'denied',
      resource: { kind: 'tool', id: 'platform.model_info' },
    });
  });

  it('nennt nur, wofuer die App eine Freigabe hat, und ruft kein Modell', async () => {
    const provider = createScriptedModelProvider({ kind: 'openai-compatible', local: false });
    const harness = await setup(scriptedModelSetup(provider));
    await grantTool(harness, 'knowledge', 'embed');
    const response = await signedCall(harness, 'model_info', {});
    expect(response.status).toBe(200);
    const info = (await response.json()) as Record<string, unknown>;
    expect(info).toMatchObject({
      chat: null,
      embedding: {
        provider: 'openai-compatible',
        model: 'test-embedding-model',
        dimensions: null,
        local: false,
      },
      budget: {
        subject: { limit: 200_000, used: 0 },
        installation: { limit: 1_000_000, used: 0 },
      },
    });
    expect(provider.chats).toHaveLength(0);
    expect(provider.embeds).toHaveLength(0);
    expect(harness.store.modelUsage.rows).toHaveLength(0);

    await grantTool(harness, 'knowledge', 'generate');
    const both = (await (await signedCall(harness, 'model_info', {})).json()) as {
      chat: unknown;
    };
    expect(both.chat).toMatchObject({ model: 'test-chat-model' });
  });

  it('zaehlt den Verbrauch des Tages fuer die App selbst', async () => {
    const harness = await setup(scriptedModelSetup(createScriptedModelProvider()));
    await grantTool(harness, 'knowledge', 'embed');
    await signedCall(harness, 'embed', {
      texts: [{ id: 'a', sourceApp: 'knowledge', text: 'hello' }],
    });
    const info = (await (await signedCall(harness, 'model_info', {})).json()) as {
      budget: { subject: { used: number }; installation: { used: number } };
    };
    expect(info.budget.subject.used).toBeGreaterThan(0);
    expect(info.budget.installation.used).toBe(info.budget.subject.used);
  });

  it('ohne Konfiguration: beide null, kein Fehler', async () => {
    const harness = await setup();
    await grantTool(harness, 'knowledge', 'embed');
    await grantTool(harness, 'knowledge', 'generate');
    const response = await signedCall(harness, 'model_info', {});
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ chat: null, embedding: null, budget: null });
  });
});

describe('onBehalfOf an generate (ADR 0025)', () => {
  it('steht im Audit, gezaehlt wird auf die App', async () => {
    const harness = await setup(scriptedModelSetup(createScriptedModelProvider()));
    await grantTool(harness, 'knowledge', 'generate');
    const response = await signedCall(harness, 'generate', {
      instruction: 'Answer.',
      purpose: 'answer',
      onBehalfOf: 'user:u-anna',
      contents: [{ id: 'c1', sourceApp: 'knowledge', text: 'x' }],
    });
    expect(response.status).toBe(200);
    expect(harness.store.modelUsage.rows.at(-1)).toMatchObject({
      subject: { kind: 'app', id: 'knowledge' },
      purpose: 'answer',
    });
    const audit = harness.store.auditEntries.find((entry) => entry.action === 'model_call');
    expect(audit?.detail).toMatchObject({ purpose: 'answer', onBehalfOf: 'user:u-anna' });
  });

  it('eine falsche Form ist 400', async () => {
    const harness = await setup(scriptedModelSetup(createScriptedModelProvider()));
    await grantTool(harness, 'knowledge', 'generate');
    const response = await signedCall(harness, 'generate', {
      instruction: 'Answer.',
      onBehalfOf: 'anna; drop table',
    });
    expect(response.status).toBe(400);
  });
});

describe('Local-only-Abschnitte fuer Knowledge (ADR 0025 C)', () => {
  it('embed und generate geben Abschnitte einer Local-only-App nicht an einen externen Anbieter', async () => {
    const provider = createScriptedModelProvider({ kind: 'gemini', local: false });
    const harness = await setup(scriptedModelSetup(provider, { localOnlyApps: ['crm'] }));
    await grantTool(harness, 'knowledge', 'embed');
    await grantTool(harness, 'knowledge', 'generate');

    const embed = (await (
      await signedCall(harness, 'embed', {
        texts: [
          { id: 'chunk-wiki', sourceApp: 'wiki', text: 'Wiki text' },
          { id: 'chunk-crm', sourceApp: 'crm', text: 'CRM secret' },
        ],
      })
    ).json()) as { embeddings: { id: string }[]; withheld: string[] };
    expect(embed.embeddings.map((e) => e.id)).toEqual(['chunk-wiki']);
    expect(embed.withheld).toEqual(['chunk-crm']);
    expect(JSON.stringify(provider.embeds)).not.toContain('CRM secret');

    const generate = (await (
      await signedCall(harness, 'generate', {
        instruction: 'Answer from the sources.',
        purpose: 'answer',
        contents: [
          { id: 'chunk-wiki', sourceApp: 'wiki', text: 'Wiki text' },
          { id: 'chunk-crm', sourceApp: 'crm', text: 'CRM secret' },
        ],
      })
    ).json()) as { withheld: string[] };
    expect(generate.withheld).toEqual(['chunk-crm']);
    expect(JSON.stringify(provider.chats)).not.toContain('CRM secret');
  });
});

describe('knowledge.answer (ADR 0025 E)', () => {
  it('ohne eigene Freigabe 403: eine Freigabe fuer search oeffnet answer nicht', async () => {
    const harness = await setup();
    await createApp(harness.ctx, {
      actor: admin,
      name: 'wissen',
      manifest: {
        ...manifest('wissen'),
        offeredTools: [
          { name: 'search', description: 'Search', verb: 'read', operationId: 'search' },
          { name: 'answer', description: 'Answer', verb: 'read', operationId: 'answer' },
        ],
      },
    });
    await grant(harness.ctx, {
      actor: admin,
      subject: { kind: 'agent', id: 'recherche' },
      verb: 'execute',
      resource: { kind: 'tool', id: 'wissen.search' },
    });
    const calls: string[] = [];
    const invoker: AppToolInvoker = {
      async invoke(request) {
        calls.push(request.toolName);
        return { passages: [] };
      },
    };
    const agent = { kind: 'agent' as const, id: 'recherche' };
    await expect(
      callAppTool(harness.ctx, {
        actor: agent,
        toolResourceId: 'wissen.answer',
        args: { question: 'x' },
        invoker,
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(calls).toEqual([]);
    expect(harness.store.auditEntries.at(-1)).toMatchObject({
      action: 'call_app_tool',
      outcome: 'denied',
      resource: { kind: 'tool', id: 'wissen.answer' },
    });
  });
});
