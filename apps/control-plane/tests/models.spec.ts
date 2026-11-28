/**
 * ADR 0024 Schritt 2: Nutzung, Grenzen, lokale Apps, `generate` und `embed`.
 *
 * Die riskanten Pfade zuerst:
 *
 * - Ohne Konfiguration wird kein Anbieter gefragt; die Antwort ist
 *   `not_configured` (503), und nichts bricht.
 * - Ohne Freigabe 403, mit gefaelschter Signatur 401, beides ohne Aufruf.
 * - Die Tagesgrenze greift vor dem Aufruf, steht im Audit; ohne Env gilt der
 *   Default.
 * - Im Audit steht kein Prompt und keine Antwort.
 * - Inhalte einer App aus `OPENAPPS_MODEL_LOCAL_ONLY_APPS` gehen bei externem
 *   Anbieter nicht hinaus (`withheld`), bei lokalem schon.
 * - Der Schluessel erscheint nirgends: nicht im Audit, nicht im Log, nicht in
 *   der Antwort, nicht in einer Fehlermeldung.
 */

import {
  appCallSignatureFor,
  CALLER_HEADER,
  CALLER_ISSUED_AT_HEADER,
  CALLER_SIGNATURE_HEADER,
  sha256Hex,
} from '@openapps/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { modelSetupFromEnv, type FetchLike } from '../src/adapters/models';
import {
  appCallSecret,
  callChat,
  createApp,
  grant,
  MODEL_LIMIT_DEFAULTS,
  NotConfiguredError,
  startOfUtcDay,
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

const KEY = 'sk-fake-models-aaaaaaaaaaaaaaaa';
const MARKER = 'PROMPT-MARKER-confidential-7f3a';

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
  for (const name of ['knowledge', 'crm', 'wiki']) {
    await createApp(harness.ctx, { actor: admin, name, manifest: manifest(name) });
  }
  return harness;
}

async function grantTool(harness: Harness, app: string, tool: 'generate' | 'embed'): Promise<void> {
  await grant(harness.ctx, {
    actor: admin,
    subject: { kind: 'app', id: app },
    verb: 'execute',
    resource: { kind: 'tool', id: `platform.${tool}` },
  });
}

function signedCall(
  harness: Harness,
  options: { caller?: string; tool: string; body: Record<string, unknown>; signature?: string },
): Promise<Response> {
  const caller = options.caller ?? 'knowledge';
  const body = JSON.stringify(options.body);
  const issuedAt = String(Math.floor(harness.ctx.clock.now().getTime() / 1000));
  const signature =
    options.signature ??
    appCallSignatureFor({
      secret: appCallSecret({ masterSecret: TEST_MASTER_SECRET, appId: caller, generation: 1 }),
      caller,
      app: 'platform',
      tool: options.tool,
      issuedAt,
      bodySha256: sha256Hex(body),
    });
  const request = new Request(
    `http://openapps-control-plane:3000/api/apps/platform/tools/${options.tool}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [CALLER_HEADER]: caller,
        [CALLER_ISSUED_AT_HEADER]: issuedAt,
        [CALLER_SIGNATURE_HEADER]: signature,
      },
      body,
    },
  );
  return handleAppCall(harness.ctx, noInvoker, request, { app: 'platform', tool: options.tool });
}

const generateBody = {
  instruction: `Answer the question. ${MARKER}`,
  contents: [
    { id: 'chunk-wiki-1', sourceApp: 'wiki', text: `Wiki says hello ${MARKER}` },
    { id: 'chunk-crm-1', sourceApp: 'crm', text: `CRM secret deal ${MARKER}` },
  ],
};

describe('ohne Konfiguration', () => {
  it('generate und embed antworten not_configured (503) und fragen niemanden', async () => {
    const harness = await setup();
    await grantTool(harness, 'knowledge', 'generate');
    await grantTool(harness, 'knowledge', 'embed');
    const generate = await signedCall(harness, { tool: 'generate', body: generateBody });
    expect(generate.status).toBe(503);
    expect(await generate.json()).toMatchObject({ error: 'not_configured' });
    const embed = await signedCall(harness, {
      tool: 'embed',
      body: { texts: [{ id: 'a', sourceApp: 'wiki', text: 'x' }] },
    });
    expect(embed.status).toBe(503);
    expect(harness.store.modelUsage.rows).toHaveLength(0);
    expect(
      harness.store.auditEntries.filter((e) => e.action === 'model_call').at(-1),
    ).toMatchObject({
      outcome: 'error',
      reason: 'not_configured',
    });
  });

  it('auch mit leerer Env aus modelSetupFromEnv: not_configured ohne Aufruf', async () => {
    const fetch: FetchLike = vi.fn(async () => new Response('{}'));
    const harness = await setup(modelSetupFromEnv({}, { fetch }));
    await expect(
      callChat(harness.ctx, {
        actor: { kind: 'user', id: 'u-ben' },
        purpose: 'summary',
        resource: null,
        request: { messages: [{ role: 'user', content: 'hi' }], maxOutputTokens: 10 },
      }),
    ).rejects.toBeInstanceOf(NotConfiguredError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('ohne Zaehlung (kein modelUsage) wird nie aufgerufen', async () => {
    const provider = createScriptedModelProvider();
    const harness = await setup(scriptedModelSetup(provider));
    const { modelUsage: _ignored, ...withoutUsage } = harness.ctx;
    await expect(
      callChat(withoutUsage, {
        actor: { kind: 'user', id: 'u-ben' },
        purpose: 'summary',
        resource: null,
        request: { messages: [{ role: 'user', content: 'hi' }], maxOutputTokens: 10 },
      }),
    ).rejects.toBeInstanceOf(NotConfiguredError);
    expect(provider.chats).toHaveLength(0);
  });
});

describe('Freigabe und Signatur', () => {
  let harness: Harness;
  const provider = createScriptedModelProvider();
  beforeEach(async () => {
    provider.chats.length = 0;
    harness = await setup(scriptedModelSetup(provider));
  });

  it('ohne Freigabe 403 mit Audit, kein Aufruf', async () => {
    const response = await signedCall(harness, { tool: 'generate', body: generateBody });
    expect(response.status).toBe(403);
    expect(provider.chats).toHaveLength(0);
    expect(harness.store.auditEntries.at(-1)).toMatchObject({
      action: 'generate',
      outcome: 'denied',
      resource: { kind: 'tool', id: 'platform.generate' },
    });
  });

  it('eine gefaelschte Signatur oder das Secret einer anderen App ist 401, kein Aufruf', async () => {
    await grantTool(harness, 'knowledge', 'generate');
    expect(
      (
        await signedCall(harness, {
          tool: 'generate',
          body: generateBody,
          signature: 'a'.repeat(64),
        })
      ).status,
    ).toBe(401);
    const body = JSON.stringify(generateBody);
    const issuedAt = String(Math.floor(Date.now() / 1000));
    const wrongSecret = appCallSignatureFor({
      secret: appCallSecret({ masterSecret: TEST_MASTER_SECRET, appId: 'wiki', generation: 1 }),
      caller: 'knowledge',
      app: 'platform',
      tool: 'generate',
      issuedAt,
      bodySha256: sha256Hex(body),
    });
    expect(
      (await signedCall(harness, { tool: 'generate', body: generateBody, signature: wrongSecret }))
        .status,
    ).toBe(401);
    expect(provider.chats).toHaveLength(0);
  });

  it('eine Freigabe fuer generate oeffnet embed nicht', async () => {
    await grantTool(harness, 'knowledge', 'generate');
    const embed = await signedCall(harness, {
      tool: 'embed',
      body: { texts: [{ id: 'a', sourceApp: 'wiki', text: 'x' }] },
    });
    expect(embed.status).toBe(403);
  });

  it('mit Freigabe: Antwort, Nutzung auf app:<name>, Audit ohne Prompt und ohne Antwort', async () => {
    await grantTool(harness, 'knowledge', 'generate');
    const reply = createScriptedModelProvider({ replies: [{ text: `The answer ${MARKER}` }] });
    harness = { ...harness, ctx: { ...harness.ctx, models: scriptedModelSetup(reply) } };
    const response = await signedCall(harness, { tool: 'generate', body: generateBody });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload).toMatchObject({
      status: 'ok',
      withheld: [],
      model: { model: 'test-chat-model' },
    });
    expect(reply.chats[0]?.messages[0]).toMatchObject({ role: 'user' });

    const usage = harness.store.modelUsage.rows.at(-1);
    expect(usage).toMatchObject({
      subject: { kind: 'app', id: 'knowledge' },
      purpose: 'generate',
      kind: 'chat',
      outcome: 'ok',
      inputTokens: 10,
      outputTokens: 5,
    });
    const audit = harness.store.auditEntries.find((entry) => entry.action === 'model_call');
    expect(audit).toMatchObject({
      outcome: 'allowed',
      detail: { purpose: 'generate', inputTokens: 10 },
    });
    expect(JSON.stringify(harness.store.auditEntries)).not.toContain(MARKER);
    expect(JSON.stringify(harness.store.modelUsage.rows)).not.toContain(MARKER);
  });

  it('pruefe die Form: Inhalte nur mit Quell-App, sonst 400 mit Audit', async () => {
    await grantTool(harness, 'knowledge', 'generate');
    const response = await signedCall(harness, {
      tool: 'generate',
      body: { instruction: 'x', contents: [{ id: 'a', text: 'no source' }] },
    });
    expect(response.status).toBe(400);
    expect(provider.chats).toHaveLength(0);
    expect(harness.store.auditEntries.at(-1)).toMatchObject({
      action: 'generate',
      outcome: 'error',
    });
  });
});

describe('Tagesgrenzen', () => {
  it('je Subjekt: ueberschritten blockiert vor dem Aufruf, Zeile und Audit, 429', async () => {
    const provider = createScriptedModelProvider({
      usage: { inputTokens: 400, outputTokens: 400 },
    });
    const harness = await setup(
      scriptedModelSetup(provider, { limits: { dailyTokensPerSubject: 3000 } }),
    );
    await grantTool(harness, 'knowledge', 'generate');
    const body = { instruction: 'Short.', maxTokens: 1000 };
    expect((await signedCall(harness, { tool: 'generate', body })).status).toBe(200);
    expect((await signedCall(harness, { tool: 'generate', body })).status).toBe(200);
    // 1600 verbraucht, dazu die Schaetzung (Text plus 1000 Ausgabe): passt noch.
    expect((await signedCall(harness, { tool: 'generate', body })).status).toBe(200);
    const blocked = await signedCall(harness, { tool: 'generate', body });
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({ error: 'budget_exceeded' });
    expect(provider.chats).toHaveLength(3);
    expect(harness.store.modelUsage.rows.at(-1)).toMatchObject({
      outcome: 'budget_exceeded',
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(harness.store.auditEntries.at(-1)).toMatchObject({
      action: 'model_call',
      outcome: 'denied',
    });
    expect(String(harness.store.auditEntries.at(-1)?.reason)).toContain('budget_exceeded');
  });

  it('die Installation zaehlt ueber alle Subjekte', async () => {
    const provider = createScriptedModelProvider({ usage: { inputTokens: 1200, outputTokens: 0 } });
    const harness = await setup(scriptedModelSetup(provider, { limits: { dailyTokens: 2500 } }));
    await grantTool(harness, 'knowledge', 'generate');
    await grantTool(harness, 'wiki', 'generate');
    const body = { instruction: 'Short.', maxTokens: 100 };
    expect((await signedCall(harness, { tool: 'generate', body })).status).toBe(200);
    expect((await signedCall(harness, { caller: 'wiki', tool: 'generate', body })).status).toBe(
      200,
    );
    expect((await signedCall(harness, { caller: 'wiki', tool: 'generate', body })).status).toBe(
      429,
    );
    expect(String(harness.store.auditEntries.at(-1)?.reason)).toContain('this installation');
  });

  it('ohne Env gilt der Default je Subjekt (200 000 Tokens am UTC-Tag)', async () => {
    const fetch: FetchLike = vi.fn(async () =>
      Response.json({
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
    const models = modelSetupFromEnv(
      {
        OPENAPPS_CHAT_PROVIDER: 'anthropic',
        OPENAPPS_CHAT_MODEL: 'claude-test',
        OPENAPPS_CHAT_API_KEY: KEY,
      },
      { fetch },
    );
    expect(models.limits).toEqual(MODEL_LIMIT_DEFAULTS);
    const harness = await setup(models);
    await grantTool(harness, 'knowledge', 'generate');
    await harness.store.modelUsage.append({
      occurredAt: harness.ctx.clock.now(),
      subject: { kind: 'app', id: 'knowledge' },
      purpose: 'generate',
      kind: 'chat',
      provider: 'anthropic',
      model: 'claude-test',
      inputTokens: MODEL_LIMIT_DEFAULTS.dailyTokensPerSubject - 50,
      outputTokens: 0,
      durationMs: 1,
      outcome: 'ok',
      runId: null,
    });
    const response = await signedCall(harness, {
      tool: 'generate',
      body: { instruction: 'Hi.', maxTokens: 100 },
    });
    expect(response.status).toBe(429);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('gezaehlt wird ab Mitternacht UTC: Nutzung von gestern zaehlt nicht', async () => {
    const provider = createScriptedModelProvider();
    const harness = await setup(
      scriptedModelSetup(provider, { limits: { dailyTokensPerSubject: 5000 } }),
    );
    await grantTool(harness, 'knowledge', 'generate');
    await harness.store.modelUsage.append({
      occurredAt: new Date(startOfUtcDay(harness.ctx.clock.now()).getTime() - 1),
      subject: { kind: 'app', id: 'knowledge' },
      purpose: 'generate',
      kind: 'chat',
      provider: 'anthropic',
      model: 'test-chat-model',
      inputTokens: 100_000,
      outputTokens: 0,
      durationMs: 1,
      outcome: 'ok',
      runId: null,
    });
    const response = await signedCall(harness, {
      tool: 'generate',
      body: { instruction: 'Hi.', maxTokens: 100 },
    });
    expect(response.status).toBe(200);
  });
});

describe('Apps, deren Inhalte im Haus bleiben (C2)', () => {
  it('externer Anbieter: CRM-Inhalt geht nicht hinaus, steht als withheld, Audit ohne Inhalt', async () => {
    const provider = createScriptedModelProvider({ local: false });
    const harness = await setup(scriptedModelSetup(provider, { localOnlyApps: ['crm'] }));
    await grantTool(harness, 'knowledge', 'generate');
    const response = await signedCall(harness, { tool: 'generate', body: generateBody });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok', withheld: ['chunk-crm-1'] });
    const sent = JSON.stringify(provider.chats);
    expect(sent).toContain('Wiki says hello');
    expect(sent).not.toContain('CRM secret deal');
    expect(sent).not.toContain('chunk-crm-1');
    const withheld = harness.store.auditEntries.find((entry) => entry.action === 'model_withheld');
    expect(withheld).toMatchObject({ detail: { apps: ['crm'], count: 1 } });
    expect(JSON.stringify(withheld)).not.toContain('CRM secret deal');
  });

  it('lokaler Anbieter: derselbe Inhalt geht mit', async () => {
    const provider = createScriptedModelProvider({ kind: 'openai-compatible', local: true });
    const harness = await setup(scriptedModelSetup(provider, { localOnlyApps: ['crm'] }));
    await grantTool(harness, 'knowledge', 'generate');
    const response = await signedCall(harness, { tool: 'generate', body: generateBody });
    expect(await response.json()).toMatchObject({ status: 'ok', withheld: [] });
    expect(JSON.stringify(provider.chats)).toContain('CRM secret deal');
  });

  it('ist die aufrufende App selbst lokal-only, geht bei externem Anbieter gar nichts hinaus', async () => {
    const provider = createScriptedModelProvider({ local: false });
    const harness = await setup(scriptedModelSetup(provider, { localOnlyApps: ['knowledge'] }));
    await grantTool(harness, 'knowledge', 'generate');
    const response = await signedCall(harness, { tool: 'generate', body: generateBody });
    expect(await response.json()).toMatchObject({
      status: 'withheld',
      text: null,
      withheld: ['chunk-wiki-1', 'chunk-crm-1'],
    });
    expect(provider.chats).toHaveLength(0);
  });

  it('embed: Vektoren nur fuer erlaubte Texte, der Rest withheld', async () => {
    const provider = createScriptedModelProvider({ local: false });
    const harness = await setup(scriptedModelSetup(provider, { localOnlyApps: ['crm'] }));
    await grantTool(harness, 'knowledge', 'embed');
    const response = await signedCall(harness, {
      tool: 'embed',
      body: {
        texts: [
          { id: 'w1', sourceApp: 'wiki', text: 'wiki text' },
          { id: 'c1', sourceApp: 'crm', text: 'crm text' },
        ],
      },
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { embeddings: { id: string }[]; withheld: string[] };
    expect(payload.embeddings.map((e) => e.id)).toEqual(['w1']);
    expect(payload.withheld).toEqual(['c1']);
    expect(provider.embeds.flatMap((request) => request.texts)).toEqual(['wiki text']);
    expect(harness.store.modelUsage.rows.at(-1)).toMatchObject({
      purpose: 'embedding',
      kind: 'embedding',
    });
  });

  it('embed: nur lokale Texte und externer Anbieter: kein Aufruf', async () => {
    const provider = createScriptedModelProvider({ local: false });
    const harness = await setup(scriptedModelSetup(provider, { localOnlyApps: ['crm'] }));
    await grantTool(harness, 'knowledge', 'embed');
    const response = await signedCall(harness, {
      tool: 'embed',
      body: { texts: [{ id: 'c1', sourceApp: 'crm', text: 'crm text' }] },
    });
    expect(await response.json()).toMatchObject({
      status: 'withheld',
      embeddings: [],
      withheld: ['c1'],
    });
    expect(provider.embeds).toHaveLength(0);
  });
});

describe('der Schluessel erscheint nirgends', () => {
  const errors: string[] = [];
  beforeEach(() => {
    errors.length = 0;
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(
        args
          .map((arg) => (arg instanceof Error ? `${arg.message} ${arg.stack ?? ''}` : String(arg)))
          .join(' '),
      );
    });
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('nicht in Antwort, Audit, Nutzung oder Log, wenn der Anbieter ihn in seinem Fehler wiederholt', async () => {
    const fetch: FetchLike = async () =>
      new Response(
        JSON.stringify({ error: { type: 'authentication_error', message: `bad key ${KEY}` } }),
        { status: 401 },
      );
    const harness = await setup(
      modelSetupFromEnv(
        {
          OPENAPPS_CHAT_PROVIDER: 'anthropic',
          OPENAPPS_CHAT_MODEL: 'claude-test',
          OPENAPPS_CHAT_API_KEY: KEY,
        },
        { fetch },
      ),
    );
    await grantTool(harness, 'knowledge', 'generate');
    const response = await signedCall(harness, { tool: 'generate', body: generateBody });
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(text).toContain('anthropic responded 401');
    expect(text).not.toContain(KEY);
    expect(JSON.stringify(harness.store.auditEntries)).not.toContain(KEY);
    expect(JSON.stringify(harness.store.modelUsage.rows)).not.toContain(KEY);
    expect(JSON.stringify(harness.ctx.models)).not.toContain(KEY);
    expect(errors.join('\n')).not.toContain(KEY);
  });

  it('nicht in Antwort und Log bei einem Netzfehler mit dem Schluessel in der Meldung', async () => {
    const fetch: FetchLike = async () => {
      throw new Error(`connect ECONNREFUSED with header x-api-key: ${KEY}`);
    };
    const harness = await setup(
      modelSetupFromEnv(
        {
          OPENAPPS_CHAT_PROVIDER: 'anthropic',
          OPENAPPS_CHAT_MODEL: 'claude-test',
          OPENAPPS_CHAT_API_KEY: KEY,
        },
        { fetch },
      ),
    );
    await grantTool(harness, 'knowledge', 'generate');
    const response = await signedCall(harness, { tool: 'generate', body: generateBody });
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain(KEY);
    expect(JSON.stringify(harness.store.auditEntries)).not.toContain(KEY);
    expect(errors.join('\n')).not.toContain(KEY);
  });
});
