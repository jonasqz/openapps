/**
 * Die Tools eines Laufs (ADR 0024 E): **genau die Tools, die der Agent ueber
 * `/mcp` saehe**, ueber denselben Server (`createPlatformServer`) und damit
 * dieselben Domaenenfunktionen (`callAppTool` fuer App-Tools). Verbunden
 * im Prozess ueber das MCP-SDK (`InMemoryTransport`), ohne Netz.
 *
 * Der Unterschied zu `/mcp` liegt nicht hier, sondern im Kontext: `ctx` ist
 * der Kontext des Laufs (`contextForRun`), dessen Freigaben der Agent
 * geschnitten mit dem Ausloeser sind, ohne lokale Apps bei externem
 * Anbieter. Jeder Aufruf traegt die Lauf-Id als `correlationId`.
 *
 * Nicht angeboten und nicht ausgefuehrt werden `RUN_EXCLUDED_TOOLS`. Der
 * Lauf erreicht den Server nur hierueber; ein Name, der nicht angeboten
 * wurde, laeuft nicht.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  appsForAppTool,
  appsInToolResult,
  RUN_EXCLUDED_TOOLS,
  type AppToolInvoker,
  type AppToolRef,
  type ChatToolSpec,
  type DomainContext,
  type RefCache,
  type RunScope,
  type RunToolbox,
} from '@openapps/control-plane/domain';
import { createPlatformServer } from './server';

export interface RunToolboxInput {
  /** Der Kontext des Laufs, nicht der der Plattform. */
  readonly ctx: DomainContext;
  readonly scope: RunScope;
  readonly invoker: AppToolInvoker;
  readonly refCache?: RefCache;
}

/** Das Schema ohne `$schema`: Nicht jeder Anbieter nimmt das Feld. */
function schemaOf(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { type: 'object', properties: {} };
  }
  const { $schema: _ignored, ...rest } = value as Record<string, unknown>;
  return rest;
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter(
      (entry): entry is { type: 'text'; text: string } =>
        typeof entry === 'object' &&
        entry !== null &&
        (entry as { type?: unknown }).type === 'text' &&
        typeof (entry as { text?: unknown }).text === 'string',
    )
    .map((entry) => entry.text)
    .join('\n');
}

export async function createRunToolbox(input: RunToolboxInput): Promise<RunToolbox> {
  const appTools = new Map<string, AppToolRef>();
  const server = await createPlatformServer({
    ctx: input.ctx,
    actor: { kind: 'agent', id: input.scope.agentName },
    invoker: input.invoker,
    correlationId: input.scope.runId,
    run: input.scope,
    onAppTool: (name, tool) => appTools.set(name, tool),
    ...(input.refCache === undefined ? {} : { refCache: input.refCache }),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  // Dieselbe enge Zusicherung wie in `http.ts`: Das SDK verlangt in
  // `connect` ein `sessionId: string`, das es selbst als optional deklariert.
  await server.connect(serverTransport as unknown as Transport);
  const client = new Client({ name: 'openapps-agent-run', version: '0.1.0' });
  await client.connect(clientTransport as unknown as Transport);

  const listed = await client.listTools();
  const tools: ChatToolSpec[] = listed.tools
    .filter((tool) => !RUN_EXCLUDED_TOOLS.includes(tool.name))
    .map((tool) => ({
      name: tool.name,
      description: tool.description ?? tool.name,
      inputSchema: schemaOf(tool.inputSchema),
    }));
  const offered = new Set(tools.map((tool) => tool.name));
  const known = new Set((await input.ctx.apps.listAll()).map((app) => app.name));

  return {
    tools,
    async call(name, args) {
      if (!offered.has(name)) return { ok: false, content: `unknown tool "${name}"`, apps: [] };
      const appTool = appTools.get(name);
      let text = '';
      let ok = false;
      try {
        const result = await client.callTool({ name, arguments: { ...args } });
        text = textOf(result.content);
        ok = result.isError !== true;
      } catch {
        text = 'the tool call failed';
      }
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        parsed = null;
      }
      // Herkunft: die App eines App-Tools (und bei Apps, die andere Apps
      // zeigen, alles Lesbare), dazu jede App, die im Ergebnis steht.
      const apps = new Set(appsInToolResult(parsed, known));
      if (appTool !== undefined) {
        for (const app of await appsForAppTool(input.ctx, input.scope.agentName, appTool.appName)) {
          apps.add(app);
        }
      }
      return { ok, content: text, apps: [...apps].sort() };
    },
    async close() {
      await client.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    },
  };
}
