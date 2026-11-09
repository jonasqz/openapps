/**
 * Die Verdrahtung mit dem MCP-SDK — absichtlich duenn.
 *
 * Alles, was entscheidet, liegt in `tools.ts` und `app-tools.ts` und ist ohne
 * Transport testbar. Diese Datei haengt es an den Server und uebersetzt
 * Ergebnisse in MCP-Inhalte. Wer das SDK tauscht, aendert nur hier.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Actor, DomainContext } from '@openapps/control-plane/domain';
import { z } from 'zod';
import { callAppTool, listAppTools, type AppToolInvoker } from './app-tools';
import { HOW_TO_BUILD_APP, HOW_TO_BUILD_APP_DESCRIPTION, readAgentsMd } from './prompts';
import { platformTools, runTool, type AnyToolDefinition } from './tools';

export interface PlatformServerOptions {
  readonly ctx: DomainContext;
  /** Der angemeldete Aufrufer. Es gibt keinen anonymen Zugang. */
  readonly actor: Actor;
  readonly invoker: AppToolInvoker;
  readonly correlationId?: string;
}

export async function createPlatformServer(options: PlatformServerOptions): Promise<McpServer> {
  const server = new McpServer({ name: 'openapps-platform', version: '0.1.0' });
  const call = {
    ctx: options.ctx,
    actor: options.actor,
    ...(options.correlationId === undefined ? {} : { correlationId: options.correlationId }),
  };

  for (const tool of platformTools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: rawShapeOf(tool),
        // Der Titel gehoert in diesem SDK unter `annotations`, nicht an die
        // Wurzel der Konfiguration.
        annotations: { title: tool.title },
      },
      async (args: unknown) => toContent(await runTool(tool, call, args)),
    );
  }

  // App-Tools: nur die freigegebenen werden ueberhaupt angemeldet. Der Aufruf
  // prueft trotzdem noch einmal — Ausblenden ist keine Durchsetzung.
  for (const appTool of await listAppTools(options.ctx, options.actor)) {
    server.registerTool(
      appTool.resourceId,
      {
        description:
          appTool.description ?? `Tool "${appTool.toolName}" der App "${appTool.appName}"`,
        inputSchema: {},
        annotations: { title: `${appTool.appName}: ${appTool.toolName}` },
      },
      async (args: unknown) => {
        try {
          const value = await callAppTool(options.ctx, {
            actor: options.actor,
            toolResourceId: appTool.resourceId,
            args: (args ?? {}) as Record<string, unknown>,
            invoker: options.invoker,
            ...(options.correlationId === undefined
              ? {}
              : { correlationId: options.correlationId }),
          });
          return toContent({ ok: true, value });
        } catch (error) {
          return toContent({
            ok: false,
            error: {
              code: 'permission_denied',
              message: error instanceof Error ? error.message : String(error),
            },
          });
        }
      },
    );
  }

  server.prompt(HOW_TO_BUILD_APP, HOW_TO_BUILD_APP_DESCRIPTION, async () => {
    const text = await readAgentsMd();
    return {
      messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }],
    };
  });

  return server;
}

/**
 * Das SDK erwartet die Felder eines Zod-Objekts, nicht das Objekt. Die
 * Zusicherung ist eng und belegt: jedes Tool in `platformTools` wird mit
 * `z.object({...})` gebaut, hat also eine `shape`.
 */
function rawShapeOf(tool: AnyToolDefinition): z.ZodRawShape {
  return (tool.schema as z.ZodObject<z.ZodRawShape>).shape;
}

function toContent(result: unknown): {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
} {
  const failed =
    typeof result === 'object' && result !== null && 'ok' in result && result.ok === false;
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    ...(failed ? { isError: true } : {}),
  };
}
