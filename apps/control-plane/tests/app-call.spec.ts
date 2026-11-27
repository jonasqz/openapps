/**
 * Aufruf von App zu App (ADR 0020): `POST /api/apps/<app>/tools/<tool>`.
 *
 * Die riskanten Pfade zuerst: Eine App ohne Freigabe wird abgewiesen; eine
 * gefaelschte, fremde, veraenderte oder abgelaufene Signatur kommt nicht
 * durch; jeder Versuch steht im Audit-Log. Danach der gute Weg bis in eine
 * echte Ziel-App mit dem SDK: Sie sieht, dass eine App ruft und welche, und
 * bekommt die lesbaren Apps nur, wenn ihr Manifest sie anfordert.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  appCallSignatureFor,
  CALLER_HEADER,
  CALLER_ISSUED_AT_HEADER,
  CALLER_SIGNATURE_HEADER,
  createToolRoute,
  sha256Hex,
  ToolInputError,
  type ToolContext,
} from '@openapps/sdk';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  appAuthSecret,
  appCallSecret,
  callAppTool,
  createApp,
  grant,
  revoke,
  type AppManifest,
  type AppToolInvoker,
} from '../src/domain';
import { createHttpInvoker } from '../src/infra/app-tool-invoker';
import { grantSelfRequests } from '../src/infra/lokal-freigaben';
import { handleAppCall } from '../src/lib/app-call';
import {
  admin,
  createHarness,
  manifest,
  seedBootstrapGrants,
  TEST_MASTER_SECRET,
  type Harness,
} from './helpers';

const APPS_DOMAIN = 'apps.example.com';

function knowledgeManifest(): AppManifest {
  return {
    ...manifest('knowledge'),
    gatewayContext: ['readableApps'],
    offeredTools: [
      { name: 'documents.upsert', description: 'Upsert', verb: 'write', operationId: 'upsert' },
      { name: 'search', description: 'Search', verb: 'read', operationId: 'search' },
    ],
  };
}

function wikiManifest(): AppManifest {
  return {
    ...manifest('wiki'),
    requestedGrants: [
      {
        subjectKind: 'app',
        subjectId: 'wiki',
        verb: 'execute',
        resource: { kind: 'tool', app: 'knowledge', name: 'documents.upsert' },
        reason: 'Deliver pages to search',
      },
      // Ein Antrag fuer eine andere App wird lokal nie erteilt.
      {
        subjectKind: 'app',
        subjectId: 'crm',
        verb: 'execute',
        resource: { kind: 'tool', app: 'knowledge', name: 'search' },
        reason: 'not for wiki to ask',
      },
      {
        subjectKind: 'group',
        verb: 'read',
        resource: { kind: 'app', app: 'wiki' },
        reason: 'group',
      },
    ],
  };
}

/** Was die Ziel-App im Tool-Handler gesehen hat. */
interface Seen {
  args: unknown;
  ctx: ToolContext;
}

/**
 * Eine echte Ziel-App: `createToolRoute` aus dem SDK hinter einem
 * HTTP-Server, mit dem Secret, das die Control Plane fuer `knowledge` ableitet.
 */
function startTarget(seen: Seen[]): Promise<{ server: Server; url: string }> {
  const route = createToolRoute(
    {
      'documents.upsert': async (args, ctx) => {
        if ((args as { key?: unknown }).key === 'bad') throw new ToolInputError('key is bad');
        seen.push({ args, ctx });
        return { ok: true };
      },
      search: async (args, ctx) => {
        seen.push({ args, ctx });
        return { passages: [] };
      },
    },
    {
      secret: appAuthSecret({
        masterSecret: TEST_MASTER_SECRET,
        appId: 'knowledge',
        generation: 1,
      }),
      appId: 'knowledge',
      appHost: APPS_DOMAIN,
      onError: () => undefined,
    },
  );
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === 'string') headers.set(key, value);
      }
      const tool = decodeURIComponent((req.url ?? '').split('/').pop() ?? '');
      void route(
        new Request(`http://target${req.url ?? '/'}`, {
          method: 'POST',
          headers,
          body: Buffer.concat(chunks),
        }),
        { params: { tool } },
      ).then(async (response) => {
        res.writeHead(response.status, { 'content-type': 'application/json' });
        res.end(await response.text());
      });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${String(port)}` });
    });
  });
}

describe('App ruft App ueber die Control Plane', () => {
  let harness: Harness;
  let target: { server: Server; url: string };
  let invoker: AppToolInvoker;
  const seen: Seen[] = [];

  beforeAll(async () => {
    target = await startTarget(seen);
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => target.server.close(() => resolve()));
  });

  beforeEach(async () => {
    seen.length = 0;
    harness = createHarness({ appsDomain: APPS_DOMAIN });
    await seedBootstrapGrants(harness);
    await createApp(harness.ctx, {
      actor: admin,
      name: 'knowledge',
      manifest: knowledgeManifest(),
    });
    await createApp(harness.ctx, { actor: admin, name: 'wiki', manifest: wikiManifest() });
    await createApp(harness.ctx, { actor: admin, name: 'crm', manifest: manifest('crm') });
    invoker = createHttpInvoker({
      authMasterSecret: TEST_MASTER_SECRET,
      addressOverride: () => target.url,
      now: () => harness.ctx.clock.now().getTime(),
    });
  });

  function nowSeconds(): string {
    return String(Math.floor(harness.ctx.clock.now().getTime() / 1000));
  }

  /** Ein Aufruf, wie `callAppTool` aus dem SDK ihn baut. */
  function signedCall(options: {
    caller?: string;
    secretOf?: string;
    app?: string;
    tool?: string;
    body?: string;
    sentBody?: string;
    issuedAt?: string;
    signature?: string;
  }): Request {
    const caller = options.caller ?? 'wiki';
    const app = options.app ?? 'knowledge';
    const tool = options.tool ?? 'documents.upsert';
    const body = options.body ?? JSON.stringify({ key: 'p1', title: 'T', content: 'x' });
    const issuedAt = options.issuedAt ?? nowSeconds();
    const signature =
      options.signature ??
      appCallSignatureFor({
        secret: appCallSecret({
          masterSecret: TEST_MASTER_SECRET,
          appId: options.secretOf ?? caller,
          generation: 1,
        }),
        caller,
        app,
        tool,
        issuedAt,
        bodySha256: sha256Hex(body),
      });
    return new Request(`http://openapps-control-plane:3000/api/apps/${app}/tools/${tool}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [CALLER_HEADER]: caller,
        [CALLER_ISSUED_AT_HEADER]: issuedAt,
        [CALLER_SIGNATURE_HEADER]: signature,
      },
      body: options.sentBody ?? body,
    });
  }

  async function call(request: Request, app = 'knowledge', tool = 'documents.upsert') {
    return handleAppCall(harness.ctx, invoker, request, { app, tool });
  }

  async function wikiMayUpsert(): Promise<string> {
    const created = await grant(harness.ctx, {
      actor: admin,
      subject: { kind: 'app', id: 'wiki' },
      verb: 'execute',
      resource: { kind: 'tool', id: 'knowledge.documents.upsert' },
    });
    return created.id;
  }

  it('weist eine App ohne Freigabe mit 403 ab und protokolliert das', async () => {
    const response = await call(signedCall({}));
    expect(response.status).toBe(403);
    expect(seen).toHaveLength(0);
    const entries = harness.store.auditEntries.filter((e) => e.action === 'call_app_tool');
    expect(entries.at(-1)).toMatchObject({
      actor: { kind: 'app', id: 'wiki' },
      outcome: 'denied',
      resource: { kind: 'tool', id: 'knowledge.documents.upsert' },
    });
  });

  it('weist ab, sobald die Freigabe widerrufen ist', async () => {
    const id = await wikiMayUpsert();
    expect((await call(signedCall({}))).status).toBe(200);
    await revoke(harness.ctx, { actor: admin, grantId: id });
    expect((await call(signedCall({}))).status).toBe(403);
  });

  it('weist eine gefaelschte Signatur mit 401 ab, auch mit Freigabe', async () => {
    await wikiMayUpsert();
    const response = await call(signedCall({ signature: 'a'.repeat(64) }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
    expect(seen).toHaveLength(0);
    const entry = harness.store.auditEntries.filter((e) => e.action === 'call_app_tool').at(-1);
    expect(entry).toMatchObject({ outcome: 'denied', actor: { kind: 'app', id: 'wiki' } });
  });

  it('weist ab, wenn eine App sich mit ihrem eigenen Secret als andere App ausgibt', async () => {
    await wikiMayUpsert();
    // crm hat keine Freigabe und signiert mit seinem Secret, behauptet aber, wiki zu sein.
    const response = await call(signedCall({ caller: 'wiki', secretOf: 'crm' }));
    expect(response.status).toBe(401);
    expect(seen).toHaveLength(0);
  });

  it('weist ab, wenn mit dem Gateway-Secret statt dem Call-Secret signiert wurde', async () => {
    await wikiMayUpsert();
    const body = JSON.stringify({ key: 'p1' });
    const issuedAt = nowSeconds();
    const signature = appCallSignatureFor({
      secret: appAuthSecret({ masterSecret: TEST_MASTER_SECRET, appId: 'wiki', generation: 1 }),
      caller: 'wiki',
      app: 'knowledge',
      tool: 'documents.upsert',
      issuedAt,
      bodySha256: sha256Hex(body),
    });
    expect((await call(signedCall({ body, issuedAt, signature }))).status).toBe(401);
  });

  it('weist einen veraenderten Body ab', async () => {
    await wikiMayUpsert();
    const response = await call(
      signedCall({ body: '{"key":"p1"}', sentBody: '{"key":"p2","sourceApp":"crm"}' }),
    );
    expect(response.status).toBe(401);
    expect(seen).toHaveLength(0);
  });

  it('weist eine Signatur fuer ein anderes Tool oder eine andere App ab', async () => {
    await wikiMayUpsert();
    expect(
      (await call(signedCall({ tool: 'search' }), 'knowledge', 'documents.upsert')).status,
    ).toBe(401);
    expect((await call(signedCall({ app: 'crm' }), 'knowledge', 'documents.upsert')).status).toBe(
      401,
    );
  });

  it('weist eine abgelaufene Signatur ab', async () => {
    await wikiMayUpsert();
    const old = String(Number(nowSeconds()) - 61);
    expect((await call(signedCall({ issuedAt: old }))).status).toBe(401);
  });

  it('weist eine App ab, die es nicht gibt', async () => {
    expect((await call(signedCall({ caller: 'fremd' }))).status).toBe(401);
  });

  it('weist einen Aufruf ganz ohne Aufrufer-Header ab, ohne Audit-Subjekt zu erfinden', async () => {
    const before = harness.store.auditEntries.length;
    const response = await call(
      new Request('http://cp/api/apps/knowledge/tools/documents.upsert', {
        method: 'POST',
        body: '{}',
      }),
    );
    expect(response.status).toBe(401);
    expect(harness.store.auditEntries.length).toBe(before);
  });

  it('leitet mit Freigabe weiter: die Ziel-App sieht die App als Aufrufer', async () => {
    await wikiMayUpsert();
    const response = await call(signedCall({}));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.ctx.caller).toEqual({ kind: 'app', app: 'wiki' });
    expect(seen[0]?.ctx.user.id).toBe('app:wiki');
    expect(seen[0]?.args).toEqual({ key: 'p1', title: 'T', content: 'x' });
    const entry = harness.store.auditEntries.filter((e) => e.action === 'call_app_tool').at(-1);
    expect(entry).toMatchObject({ outcome: 'allowed', actor: { kind: 'app', id: 'wiki' } });
  });

  it('gibt der Ziel-App die lesbaren Apps des aufrufenden Subjekts, nicht mehr', async () => {
    await grant(harness.ctx, {
      actor: admin,
      subject: { kind: 'app', id: 'wiki' },
      verb: 'execute',
      resource: { kind: 'tool', id: 'knowledge.search' },
    });
    await grant(harness.ctx, {
      actor: admin,
      subject: { kind: 'app', id: 'wiki' },
      verb: 'read',
      resource: { kind: 'app', id: 'wiki' },
    });
    const body = JSON.stringify({ query: 'x' });
    const response = await call(signedCall({ tool: 'search', body }), 'knowledge', 'search');
    expect(response.status).toBe(200);
    expect(seen[0]?.ctx.readableApps).toEqual(['wiki']);
  });

  it('gibt einem Agenten ueber denselben Weg die lesbaren Apps (MCP)', async () => {
    await grant(harness.ctx, {
      actor: admin,
      subject: { kind: 'agent', id: 'recherche' },
      verb: 'execute',
      resource: { kind: 'tool', id: 'knowledge.search' },
    });
    await callAppTool(harness.ctx, {
      actor: { kind: 'agent', id: 'recherche' },
      toolResourceId: 'knowledge.search',
      args: { query: 'x' },
      invoker,
    });
    expect(seen[0]?.ctx.caller).toEqual({ kind: 'agent', agent: 'recherche' });
    // Keine read-Freigabe auf irgendeine App: leere, aber gueltige Liste.
    expect(seen[0]?.ctx.readableApps).toEqual([]);
  });

  it('reicht einen Eingabefehler der Ziel-App mit ihrem Status und ihrer Meldung durch', async () => {
    await wikiMayUpsert();
    const response = await call(signedCall({ body: JSON.stringify({ key: 'bad' }) }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid', message: 'key is bad' });
  });

  it('lehnt einen Pfad ab, der kein App-Tool ist', async () => {
    const response = await handleAppCall(harness.ctx, invoker, signedCall({}), {
      app: '..',
      tool: 'documents.upsert',
    });
    expect(response.status).toBe(404);
  });

  it('der lokale Aufbau erteilt nur die Antraege einer App fuer sich selbst', async () => {
    const lines: string[] = [];
    const results = await grantSelfRequests(
      harness.ctx,
      admin,
      [wikiManifest(), knowledgeManifest()],
      (line) => lines.push(line),
    );
    expect(results).toEqual([
      { label: 'app:wiki execute tool:knowledge.documents.upsert', outcome: 'granted' },
    ]);
    const again = await grantSelfRequests(harness.ctx, admin, [wikiManifest()], () => undefined);
    expect(again[0]?.outcome).toBe('already granted');
    expect((await call(signedCall({}))).status).toBe(200);
  });
});
