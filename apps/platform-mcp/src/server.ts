/**
 * Die Verdrahtung mit dem MCP-SDK — absichtlich duenn.
 *
 * Alles, was entscheidet, liegt in `tools.ts` und `app-tools.ts` und ist ohne
 * Transport testbar. Diese Datei haengt es an den Server und uebersetzt
 * Ergebnisse in MCP-Inhalte. Wer das SDK tauscht, aendert nur hier.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  PermissionDeniedError,
  type Actor,
  type DomainContext,
} from '@openapps/control-plane/domain';
import { z } from 'zod';
import { callAppTool, listAppTools, type AppToolInvoker } from './app-tools';
import { loslegenAlsText } from '@openapps/control-plane/loslegen';
import {
  HOW_TO_BUILD_APP,
  HOW_TO_BUILD_APP_DESCRIPTION,
  LOSLEGEN,
  LOSLEGEN_DESCRIPTION,
  readAgentsMd,
} from './prompts';
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
  const taken = new Set<string>(platformTools.map((tool) => tool.name));
  for (const appTool of await listAppTools(options.ctx, options.actor)) {
    const mcpName = mcpToolName(appTool.resourceId, taken);
    taken.add(mcpName);
    server.registerTool(
      mcpName,
      {
        description: `${appTool.appName}: ${
          appTool.description ?? `Tool "${appTool.toolName}" der App "${appTool.appName}"`
        }\n\nArgumente als Objekt im Feld "args" uebergeben.`,
        // Die Argumente beschreibt die App in ihrer OpenAPI-Spec und in der
        // Tool-Beschreibung; die Plattform reicht sie unveraendert durch. Ein
        // leeres Schema hier wuerde sie stillschweigend verwerfen (zod
        // entfernt unbekannte Schluessel), deshalb ein offenes Feld.
        inputSchema: {
          args: z
            .record(z.unknown())
            .optional()
            .describe('Argumente des Tools, wie in der Beschreibung genannt'),
        },
        annotations: { title: `${appTool.appName}: ${appTool.toolName}` },
      },
      async (input: { args?: Record<string, unknown> | undefined }) => {
        try {
          const value = await callAppTool(options.ctx, {
            actor: options.actor,
            toolResourceId: appTool.resourceId,
            args: input.args ?? {},
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
              // Nur eine verweigerte Freigabe heisst so. Ein Fehler der App
              // (falsche Argumente, nicht gefunden) traegt ihre Meldung, damit
              // der Agent seinen Aufruf korrigieren kann.
              code: error instanceof PermissionDeniedError ? 'permission_denied' : 'app_error',
              message: error instanceof Error ? error.message : String(error),
            },
          });
        }
      },
    );
  }

  // Dieselbe Anleitung wie die Seite /loslegen der Verwaltung, aus einer Quelle.
  server.prompt(LOSLEGEN, LOSLEGEN_DESCRIPTION, () => ({
    messages: [
      { role: 'user' as const, content: { type: 'text' as const, text: loslegenAlsText() } },
    ],
  }));

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

/**
 * Der Name, unter dem ein App-Tool im MCP erscheint. Clients wie Claude nehmen
 * nur `[a-zA-Z0-9_-]{1,64}` — `crm.contacts.list` waere unsichtbar. Aus jedem
 * anderen Zeichen wird `__`, also `crm__contacts__list`. Zurueckgerechnet wird
 * nie: Der Handler kennt seine Ressourcen-Id, der Name ist nur ein Etikett.
 */
export function mcpToolName(resourceId: string, taken: ReadonlySet<string> = new Set()): string {
  const base = resourceId.replace(/[^a-zA-Z0-9_-]/g, '__').slice(0, 60);
  let name = base;
  for (let i = 2; taken.has(name); i += 1) name = `${base}_${String(i)}`;
  return name;
}
