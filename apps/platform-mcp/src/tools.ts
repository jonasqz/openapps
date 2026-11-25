/**
 * Die Tools der Plattform — als Daten, nicht als SDK-Aufrufe.
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

import { appManifestSchema, manifestSourceSchema } from '@openapps/app-manifest';
import { z } from 'zod';
import {
  addGroupMember,
  createAgentIdentity,
  createApp,
  createGroup,
  disableAgentIdentity,
  grant,
  listAgentIdentities,
  listApps,
  listGrants,
  listGroupMembers,
  listGroups,
  recordAudit,
  removeGroupMember,
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
// `group` seit Migration 0011: Eine Gruppe ist Subjekt und Ressource. Die
// Liste muss dieselbe sein wie `ResourceKind` in der Domaene — sonst kann ein
// Agent ein Recht nicht vergeben, das das Modell kennt. `agent` seit Migration
// 0014: wer Agent-Identitaeten anlegen und sperren darf, ist eine Freigabe.
const resourceKind = z.enum(['app', 'table', 'view', 'tool', 'group', 'agent']);

/**
 * Das Manifest wird mit dem maßgeblichen Schema geprueft, nicht mit einem
 * zweiten: `appManifestSchema` aus `@openapps/app-manifest`. Eine zweite
 * Wahrheit waere eine zu viel — und der Agent bekommt bei einem Fehler genau
 * die Meldung, die auch das Review-Gate geben wuerde.
 */

const codeFactsSchema = z.object({
  tables: z.array(z.string()),
  tools: z.array(z.string()),
  envVars: z.array(z.string()),
});

export const createAppTool = defineTool({
  name: 'create_app',
  title: 'Create app',
  description:
    'Creates a repo from the starter template, registers the app and sets up its own schema with its own DB role. Afterwards the app is neither deployed nor visible to anyone; that takes request_deploy and grant. If creating the repo fails, nothing is registered.',
  schema: z.object({
    name: z.string(),
    displayName: z.string().optional(),
    manifest: appManifestSchema,
    /**
     * Nur fuer ein **bestehendes** Repo. Ohne Angabe legt die Control Plane
     * eines aus dem Starter-Template an — das ist der Normalweg (DoD 1).
     */
    source: manifestSourceSchema.optional(),
  }),
  async handler({ ctx, actor, correlationId }, input) {
    const app = await createApp(ctx, {
      actor,
      name: input.name,
      manifest: input.manifest,
      ...(input.source === undefined ? {} : { source: input.source }),
      ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
      ...(correlationId === undefined ? {} : { correlationId }),
    });
    return { app };
  },
});

export const listAppsTool = defineTool({
  name: 'list_apps',
  title: 'List apps',
  description: 'Lists the apps the caller has a read grant on. Without a grant the list is empty.',
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
  title: 'Request deploy',
  description:
    'Deploys a pushed commit: the platform fetches it from the app repo itself (pass repoDir only for local runs). Starts the review gate (gitleaks, semgrep, UI linter, tool parity, manifest check, Claude report) and deploys only if it passes. A blocking finding from any scanner prevents the deploy; the Claude report alone never approves.',
  schema: z.object({
    app: z.string(),
    version: z.string(),
    gitSha: z.string(),
    repoDir: z.string().optional(),
    manifest: appManifestSchema.optional(),
    uiActions: z.array(z.string()).optional(),
    codeFacts: codeFactsSchema.optional(),
  }),
  async handler({ ctx, actor, correlationId }, input) {
    return requestDeploy(ctx, {
      actor,
      appIdOrName: input.app,
      version: input.version,
      gitSha: input.gitSha,
      ...(input.repoDir === undefined ? {} : { repoDir: input.repoDir }),
      ...(input.manifest === undefined ? {} : { manifest: input.manifest }),
      ...(input.uiActions === undefined ? {} : { uiActions: input.uiActions }),
      ...(input.codeFacts === undefined ? {} : { codeFacts: input.codeFacts }),
      ...(correlationId === undefined ? {} : { correlationId }),
    });
  },
});

export const rollbackTool = defineTool({
  name: 'rollback',
  title: 'Roll back to the previous version',
  description:
    'Rolls the app back to the previous deployment: a pointer swap plus one backend call, so it stays under 2 minutes.',
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
  title: 'Grant permission',
  description:
    'Grants exactly one permission: a subject (user, group, app, agent) may perform a verb (read, write, execute) on a resource (app, table, view, tool, group, agent). For tables and views shared between apps, the Postgres grant is set as well.',
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
  title: 'Revoke grant',
  description:
    'Revokes a grant. It stops taking effect immediately because no check caches grants; for tables and views the Postgres REVOKE follows.',
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
  title: 'List grants',
  description:
    'Lists grants. Without arguments, your own grants; anyone may do that. With a resource, the grants on that resource, provided the caller may read it. With all: true, every grant on the platform (needs read on app:*).',
  schema: z.object({
    resourceKind: resourceKind.optional(),
    resourceId: z.string().optional(),
    all: z.boolean().optional(),
  }),
  async handler({ ctx, actor, correlationId }, input) {
    const scope =
      input.resourceKind !== undefined && input.resourceId !== undefined
        ? { resource: { kind: input.resourceKind, id: input.resourceId } }
        : input.all === true
          ? {}
          : // Ohne Angabe die eigenen, wie beschrieben. Vorher fiel das in
            // "alle" und brauchte Admin-Rechte: Ein Agent konnte nie
            // nachsehen, was er selbst darf (zweiter Agent-Lauf, ADR 0011).
            { subject: { kind: actor.kind, id: actor.id } };
    const grants = await listGrants(ctx, {
      actor,
      ...scope,
      ...(correlationId === undefined ? {} : { correlationId }),
    });
    return { grants };
  },
});

/* -------------------------------------------------------------------------- */
/* Gruppen (Migration 0009 und 0011)                                           */
/* -------------------------------------------------------------------------- */

/**
 * Warum es diese vier Tools gibt: Eine Freigabe an eine Gruppe wirkt nur,
 * wenn jemand die Mitglieder pflegen kann. Ohne sie ging das per SQL oder
 * ueber `AUTH_BOOTSTRAP_ADMINS` — beides Wege um das Rechtemodell herum, und
 * keiner davon fuer einen Agent erreichbar (CLAUDE.md, Grundsatz 1).
 */
export const listGroupsTool = defineTool({
  name: 'list_groups',
  title: 'List groups',
  description:
    'Lists the groups the caller has a read grant on (read on group:<name> or group:*). Without a grant the list is empty.',
  schema: z.object({}),
  async handler({ ctx, actor, correlationId }) {
    const groups = await listGroups(ctx, {
      actor,
      ...(correlationId === undefined ? {} : { correlationId }),
    });
    return { groups };
  },
});

export const createGroupTool = defineTool({
  name: 'create_group',
  title: 'Create group',
  description:
    'Creates a group. Needs write on group:*, not on the new name, because it does not exist before it is created. The group starts empty and only takes effect once it has members and a grant.',
  schema: z.object({
    name: z.string(),
    description: z.string().optional(),
  }),
  async handler({ ctx, actor, correlationId }, input) {
    const group = await createGroup(ctx, {
      actor,
      name: input.name,
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(correlationId === undefined ? {} : { correlationId }),
    });
    return { group };
  },
});

export const listGroupMembersTool = defineTool({
  name: 'list_group_members',
  title: 'List group members',
  description:
    'Lists the members of a group. Needs read on that group. Members are email addresses, not user ids: a membership can be granted before the first login.',
  schema: z.object({ group: z.string() }),
  async handler({ ctx, actor, correlationId }, input) {
    const members = await listGroupMembers(ctx, {
      actor,
      group: input.group,
      ...(correlationId === undefined ? {} : { correlationId }),
    });
    return { group: input.group, members };
  },
});

export const grantGroupMemberTool = defineTool({
  name: 'grant_group_member',
  title: 'Add group member',
  description:
    'Adds an email address to a group. Needs write on that group. Idempotent: if the address was already a member, added is false and nothing changes. Every grant to the group then applies to this address without being copied.',
  schema: z.object({ group: z.string(), email: z.string() }),
  async handler({ ctx, actor, correlationId }, input) {
    return addGroupMember(ctx, {
      actor,
      group: input.group,
      email: input.email,
      ...(correlationId === undefined ? {} : { correlationId }),
    });
  },
});

export const revokeGroupMemberTool = defineTool({
  name: 'revoke_group_member',
  title: 'Remove group member',
  description:
    'Removes an email address from a group. Needs write on that group. Takes effect immediately: groups are read on every call, not cached, so every grant that came through this group is gone on the next call.',
  schema: z.object({ group: z.string(), email: z.string() }),
  async handler({ ctx, actor, correlationId }, input) {
    return removeGroupMember(ctx, {
      actor,
      group: input.group,
      email: input.email,
      ...(correlationId === undefined ? {} : { correlationId }),
    });
  },
});

/**
 * Agent-Identitaeten. Ohne diese drei Tools gaebe es einen Agent nur per
 * SQL-Insert — und damit eine Aktion, die kein Agent ausfuehren kann
 * (CLAUDE.md, Grundsatz 1). Den allerersten legt ein Mensch ueber die Seite
 * `/agents` an; jeder weitere kann von einem Agent kommen, der `write` auf
 * `agent:*` hat.
 */
export const listAgentsTool = defineTool({
  name: 'list_agents',
  title: 'List agents',
  description:
    'Lists the agent identities the caller has a read grant on (read on agent:<name> or agent:*). Secrets never appear in the list; only their hash is stored.',
  schema: z.object({}),
  async handler({ ctx, actor, correlationId }) {
    const agents = await listAgentIdentities(ctx, {
      actor,
      ...(correlationId === undefined ? {} : { correlationId }),
    });
    return { agents };
  },
});

export const createAgentTool = defineTool({
  name: 'create_agent',
  title: 'Create agent',
  description:
    'Creates an agent identity and returns its token, exactly this once; afterwards nobody knows it. Needs write on agent:*. The new identity may do nothing: it only gets permissions through grant with subjectKind agent and its name as subjectId. The token belongs in the agent env, not in a repo.',
  schema: z.object({
    name: z.string(),
    displayName: z.string().optional(),
  }),
  async handler({ ctx, actor, correlationId }, input) {
    return createAgentIdentity(ctx, {
      actor,
      name: input.name,
      ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
      ...(correlationId === undefined ? {} : { correlationId }),
    });
  },
});

export const disableAgentTool = defineTool({
  name: 'disable_agent',
  title: 'Disable agent',
  description:
    'Disables an agent identity. Needs write on that agent. Takes effect on the next call: the token is checked on every call, not cached. The name stays taken so the audit log stays unambiguous; new access needs a new name.',
  schema: z.object({ name: z.string() }),
  async handler({ ctx, actor, correlationId }, input) {
    return disableAgentIdentity(ctx, {
      actor,
      name: input.name,
      ...(correlationId === undefined ? {} : { correlationId }),
    });
  },
});

/**
 * Die sechs Tools des Briefs, `list_grants` zum Nachsehen, die
 * Gruppenpflege und die Agent-Identitaeten. Mehr gibt es nicht: jede weitere Plattform-Aktion entsteht
 * erst als Domaenenfunktion.
 */
export const platformTools: readonly AnyToolDefinition[] = [
  createAppTool,
  requestDeployTool,
  listAppsTool,
  rollbackTool,
  grantTool,
  revokeTool,
  listGrantsTool,
  listGroupsTool,
  createGroupTool,
  listGroupMembersTool,
  grantGroupMemberTool,
  revokeGroupMemberTool,
  listAgentsTool,
  createAgentTool,
  disableAgentTool,
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
      reason: `invalid input: ${parsed.error.message}`,
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
