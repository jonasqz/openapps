/**
 * Die sechs Tools der Plattform — als Daten, nicht als SDK-Aufrufe.
 *
 * Der Grund fuer diesen Zuschnitt: die Tools sollen pruefbar sein, ohne einen
 * MCP-Transport zu starten. `src/server.ts` haengt sie an das SDK; die Tests
 * rufen sie direkt. Was hier steht, ist deshalb die ganze Wahrheit ueber ein
 * Tool: Name, Beschreibung, Eingabe-Schema und Handler.
 *
 * Jedes Tool haelt sich an drei Dinge:
 *
 * 1. Es ruft **nur** Domaenenfunktionen der Control Plane. Keine SQL-Abfrage,
 *    keine eigene Rechtelogik.
 * 2. Die Rechtepruefung passiert in der Domaenenfunktion (`can` /
 *    `requirePermission`) — also vor jeder Wirkung.
 * 3. Jeder Aufruf landet im Audit-Log, auch der abgelehnte (DoD 6). Das
 *    erledigt `audited` in der Domaene; `runTool` ergaenzt den Eintrag fuer
 *    alles, was vor der Domaene scheitert.
 */

import { z } from 'zod';
import {
  createApp,
  grant,
  listApps,
  listGrants,
  recordAudit,
  requestDeploy,
  revoke,
  rollback,
  type Actor,
  type DomainContext,
} from '@openapps/control-plane/domain';

export interface ToolCallContext {
  readonly ctx: DomainContext;
  readonly actor: Actor;
  readonly correlationId?: string;
}

export interface ToolDefinition<Schema extends z.ZodTypeAny> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly schema: Schema;
  // Absichtlich als Methode deklariert: so bleibt ein konkretes Tool einer
  // Liste von `AnyToolDefinition` zuweisbar, ohne Typ-Zusicherung.
  handler(call: ToolCallContext, input: z.infer<Schema>): Promise<unknown>;
}

export type AnyToolDefinition = ToolDefinition<z.ZodTypeAny>;

/** Nur dazu da, die Eingabe-Typen aus dem Schema ableiten zu lassen. */
function defineTool<Schema extends z.ZodTypeAny>(
  definition: ToolDefinition<Schema>,
): ToolDefinition<Schema> {
  return definition;
}

const subjectKind = z.enum(['user', 'group', 'app', 'agent']);
const verb = z.enum(['read', 'write', 'execute']);
const resourceKind = z.enum(['app', 'table', 'view', 'tool']);

const catalogSource = z.union([
  z.object({ kind: z.literal('git'), url: z.string(), ref: z.string().optional() }),
  z.object({ kind: z.literal('local'), path: z.string() }),
  z.object({
    kind: z.literal('catalog'),
    catalog: z.string(),
    id: z.string(),
    version: z.string().optional(),
  }),
]);

/**
 * Das Manifest wird hier nur grob geprueft. Die maßgebliche Pruefung macht
 * `@openapps/app-manifest` — eine zweite Wahrheit waere eine zu viel.
 */
const manifestSchema = z.object({
  name: z.string(),
  displayName: z.string().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  version: z.string(),
  tables: z.array(z.object({ name: z.string(), description: z.string().optional() })).optional(),
  tools: z.array(z.object({ name: z.string(), description: z.string().optional() })).optional(),
  env: z.array(z.string()).optional(),
});

const codeFactsSchema = z.object({
  tables: z.array(z.string()),
  tools: z.array(z.string()),
  envVars: z.array(z.string()),
});

export const createAppTool = defineTool({
  name: 'create_app',
  title: 'App anlegen',
  description:
    'Legt eine App im Register an und richtet ihr eigenes Schema samt eigener DB-Rolle ein. Danach ist die App weder deployt noch fuer jemanden sichtbar — dafuer braucht sie request_deploy und grant.',
  schema: z.object({
    name: z.string(),
    displayName: z.string().optional(),
    manifest: manifestSchema,
    source: catalogSource,
  }),
  async handler({ ctx, actor, correlationId }, input) {
    const app = await createApp(ctx, {
      actor,
      name: input.name,
      manifest: input.manifest,
      source: input.source,
      ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
      ...(correlationId === undefined ? {} : { correlationId }),
    });
    return { app };
  },
});

export const listAppsTool = defineTool({
  name: 'list_apps',
  title: 'Apps auflisten',
  description:
    'Listet die Apps, auf die der Aufrufer eine Lese-Freigabe hat. Ohne Freigabe ist die Liste leer.',
  schema: z.object({}),
  async handler({ ctx, actor, correlationId }) {
    const apps = await listApps(ctx, {
      actor,
      ...(correlationId === undefined ? {} : { correlationId }),
    });
    return { apps };
  },
});

export const requestDeployTool = defineTool({
  name: 'request_deploy',
  title: 'Deploy anfragen',
  description:
    'Startet das Review-Gate (gitleaks, semgrep, UI-Linter, Tool-Paritaet, Manifest-Abgleich, Claude-Report) und deployt nur bei Freigabe. Ein blockierender Befund eines Scanners verhindert den Deploy; der Claude-Report allein gibt nie frei.',
  schema: z.object({
    app: z.string(),
    version: z.string(),
    gitSha: z.string(),
    repoDir: z.string(),
    manifest: manifestSchema.optional(),
    uiActions: z.array(z.string()).optional(),
    codeFacts: codeFactsSchema.optional(),
  }),
  async handler({ ctx, actor, correlationId }, input) {
    return requestDeploy(ctx, {
      actor,
      appIdOrName: input.app,
      version: input.version,
      gitSha: input.gitSha,
      repoDir: input.repoDir,
      ...(input.manifest === undefined ? {} : { manifest: input.manifest }),
      ...(input.uiActions === undefined ? {} : { uiActions: input.uiActions }),
      ...(input.codeFacts === undefined ? {} : { codeFacts: input.codeFacts }),
      ...(correlationId === undefined ? {} : { correlationId }),
    });
  },
});

export const rollbackTool = defineTool({
  name: 'rollback',
  title: 'Zurueck auf die Vorversion',
  description:
    'Setzt die App auf das vorherige Deployment zurueck: ein Zeiger-Tausch plus ein Backend-Aufruf, damit es unter 2 Minuten bleibt.',
  schema: z.object({ app: z.string() }),
  async handler({ ctx, actor, correlationId }, input) {
    const deployment = await rollback(ctx, {
      actor,
      appIdOrName: input.app,
      ...(correlationId === undefined ? {} : { correlationId }),
    });
    return { deployment };
  },
});

export const grantTool = defineTool({
  name: 'grant',
  title: 'Freigabe vergeben',
  description:
    'Vergibt genau ein Recht: Subjekt (Mensch, Gruppe, App, Agent) darf ein Verb (read, write, execute) auf einer Ressource (App, Tabelle, View, Tool). Bei Tabellen und Views zwischen Apps wird zusaetzlich der Postgres-Grant gesetzt.',
  schema: z.object({
    subjectKind,
    subjectId: z.string(),
    verb,
    resourceKind,
    resourceId: z.string(),
  }),
  async handler({ ctx, actor, correlationId }, input) {
    const created = await grant(ctx, {
      actor,
      subject: { kind: input.subjectKind, id: input.subjectId },
      verb: input.verb,
      resource: { kind: input.resourceKind, id: input.resourceId },
      ...(correlationId === undefined ? {} : { correlationId }),
    });
    return { grant: created };
  },
});

export const revokeTool = defineTool({
  name: 'revoke',
  title: 'Freigabe widerrufen',
  description:
    'Widerruft eine Freigabe. Sie wirkt sofort nicht mehr, weil keine Pruefung ueber Freigaben cacht; bei Tabellen und Views folgt der Postgres-REVOKE.',
  schema: z.object({ grantId: z.string() }),
  async handler({ ctx, actor, correlationId }, input) {
    const revoked = await revoke(ctx, {
      actor,
      grantId: input.grantId,
      ...(correlationId === undefined ? {} : { correlationId }),
    });
    return { grant: revoked };
  },
});

export const listGrantsTool = defineTool({
  name: 'list_grants',
  title: 'Freigaben ansehen',
  description:
    'Listet Freigaben. Ohne Angabe die eigenen; mit Ressource die Freigaben auf diese Ressource, sofern der Aufrufer sie lesen darf.',
  schema: z.object({
    resourceKind: resourceKind.optional(),
    resourceId: z.string().optional(),
  }),
  async handler({ ctx, actor }, input) {
    const grants = await listGrants(ctx, {
      actor,
      ...(input.resourceKind !== undefined && input.resourceId !== undefined
        ? { resource: { kind: input.resourceKind, id: input.resourceId } }
        : {}),
    });
    return { grants };
  },
});

/**
 * Die sechs Tools des Briefs plus `list_grants` zum Nachsehen. Mehr gibt es
 * nicht: jede weitere Plattform-Aktion entsteht erst als Domaenenfunktion.
 */
export const platformTools: readonly AnyToolDefinition[] = [
  createAppTool,
  requestDeployTool,
  listAppsTool,
  rollbackTool,
  grantTool,
  revokeTool,
  listGrantsTool,
];

export interface ToolRunResult {
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: { readonly code: string; readonly message: string };
}

/**
 * Fuehrt ein Tool aus und sorgt dafuer, dass **kein** Aufruf ohne Spur bleibt.
 * Die Domaenenfunktionen protokollieren selbst; hier wird nur ergaenzt, was
 * vorher scheitert — eine ungueltige Eingabe.
 */
export async function runTool<Schema extends z.ZodTypeAny>(
  tool: ToolDefinition<Schema>,
  call: ToolCallContext,
  rawInput: unknown,
): Promise<ToolRunResult> {
  const parsed = tool.schema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    await recordAudit(call.ctx, {
      actor: call.actor,
      action: tool.name,
      outcome: 'error',
      reason: `ungueltige Eingabe: ${parsed.error.message}`,
      ...(call.correlationId === undefined ? {} : { correlationId: call.correlationId }),
    });
    return { ok: false, error: { code: 'validation_failed', message: parsed.error.message } };
  }

  try {
    const value = await tool.handler(call, parsed.data);
    return { ok: true, value };
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code: unknown }).code)
        : 'internal_error';
    return {
      ok: false,
      error: { code, message: error instanceof Error ? error.message : String(error) },
    };
  }
}
