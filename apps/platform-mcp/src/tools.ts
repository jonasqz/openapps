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
  describeActor,
  disableAgentIdentity,
  grant,
  listAgentIdentities,
  listApps,
  listGrants,
  listGroupMembers,
  listGroups,
  listInbox,
  markInbox,
  INBOX_LIMITS,
  listActions,
  listBacklinks,
  listPeople,
  REF_LIST_LIMITS,
  REF_RESOLVE_LIMITS,
  resolveRefs,
  type RefCache,
  recordAudit,
  removeGroupMember,
  requestDeploy,
  revoke,
  rollback,
  searchApps,
  PLATFORM_SEARCH_LIMITS,
  AGENT_PROFILE_LIMITS,
  AGENT_RUN_LIMITS,
  configureAgent,
  forget,
  getAgentRun,
  listAgentProfiles,
  listAgentRuns,
  listMemories,
  MEMORY_LIMITS,
  recall,
  remember,
  startAgentRun,
  type MemoryRunScope,
  type Actor,
  type AppToolInvoker,
  type DomainContext,
} from '@openapps/control-plane/domain';

export interface ToolCallContext {
  readonly ctx: DomainContext;
  readonly actor: Actor;
  readonly correlationId?: string;
  /**
   * Weiterleitung an die Apps. Nur `search` braucht sie (ADR 0021); fehlt
   * sie, scheitert `search` mit einer klaren Meldung statt still leer.
   */
  readonly invoker?: AppToolInvoker;
  /**
   * Cache der Resolver-Antworten fuer `resolve_refs` (ADR 0023 B, 60 s).
   * Fehlt er, fragt jeder Aufruf die App. Die Rechtepruefung laeuft immer.
   */
  readonly refCache?: RefCache;
  /**
   * Gesetzt, wenn der Aufruf aus einem Lauf eines Plattform-Agents kommt
   * (ADR 0024 E). `remember` nimmt daraus die Herkunft.
   */
  readonly run?: MemoryRunScope;
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
 * Wer bin ich? Das Gegenstueck zu `GET /api/me` und zur Seite `/settings`
 * (ADR 0017). Braucht kein Recht: Die eigenen Freigaben darf jeder sehen,
 * und die Apps sind genau die, die der Aufrufer ohnehin lesen darf. Die
 * Freigaben kommen mit Herkunft (`via`), direkt oder ueber eine Gruppe; der
 * Audit-Eintrag heisst `whoami`, nicht `list_grants`.
 */
export const whoamiTool = defineTool({
  name: 'whoami',
  title: 'Who am I',
  description:
    'Shows who you are on the platform: identity, groups, the apps you can open and every open grant that applies to you. Each grant has a via field: {kind: "direct"} for a grant to you, {kind: "group", group} for a grant to one of your groups. The same right can appear more than once if it comes from several places. Anyone may call it; it only shows your own grants. Logged as whoami.',
  schema: z.object({}),
  async handler({ ctx, actor, correlationId }) {
    const me = await describeActor(ctx, actor, {
      ...(correlationId === undefined ? {} : { correlationId }),
    });
    return { me };
  },
});

/**
 * Die Suche ueber alle Apps (ADR 0021), dieselbe Domaenenfunktion wie die
 * Leiste (`GET /_platform/search`). Ein Agent bekommt Treffer einer App nur
 * mit `read` auf die App **und** `execute` auf ihr Such-Tool; ohne beides
 * wird die App nicht gefragt. Keine eigene Freigabe fuer `search` selbst:
 * Wie `list_apps` zeigt es nur, was der Aufrufer ohnehin darf.
 */
export const searchTool = defineTool({
  name: 'search',
  title: 'Search all apps',
  description:
    "Searches all apps you may search at once and returns hits grouped by app: {query, results: [{app, title, hits: [{id, title, snippet, kind, url, href}]}], failed: [{app, title, reason}], searched}. An app is searched only if you have read on the app (resourceKind app) and execute on its search tool (for example crm.search, wiki.pages.search); without both it is skipped silently. Each app gets about 2 seconds; an app that times out or errors is listed under failed and the others still answer. Arguments: query (2 to 200 characters), apps (optional list of app names to limit the search), limit (hits per app, 1 to 10, default 5). Open a hit with the app's own get tool using its id, or give the href to a person.",
  schema: z.object({
    query: z.string(),
    apps: z.array(z.string()).max(PLATFORM_SEARCH_LIMITS.appsFilterMax).optional(),
    limit: z.number().int().optional(),
  }),
  async handler({ ctx, actor, correlationId, invoker }, input) {
    if (invoker === undefined) {
      throw new Error('search is not available here: no connection to the apps');
    }
    return searchApps(ctx, {
      actor,
      query: input.query,
      invoker,
      ...(input.apps === undefined ? {} : { apps: input.apps }),
      ...(input.limit === undefined ? {} : { limit: input.limit }),
      ...(correlationId === undefined ? {} : { correlationId }),
    });
  },
});

/**
 * Der eigene Eingang (ADR 0022 D): Benachrichtigungen aus den Apps, die der
 * Aufrufer lesen darf, dieselbe Domaenenfunktion wie `GET /api/inbox` und
 * die Seite `/home`. Keine eigene Freigabe: Wie `whoami` wirkt es nur auf
 * den Eingang des Aufrufers, und jede Zeile braucht beim Lesen `read` auf
 * ihre Quell-App. Ein Widerruf blendet sie beim naechsten Aufruf aus.
 */
export const listInboxTool = defineTool({
  name: 'list_inbox',
  title: 'List my inbox',
  description: `Lists notifications from the apps for you: tasks assigned to you, deals won, pages you follow that changed, and so on. Returns {items: [{id, state, app, appTitle, type, title, href, actor, actorLabel, importance, via, viaGroup, occurredAt}], unread, apps: [{name, title}]}. Order: addressed to you directly before via a group, then importance (high, normal, low), then newest first. Only apps you may read appear; if a grant is revoked, its items disappear on the next call. Arguments (all optional): state (open = unread and read, the default; unread; read; done; all), app (one app name), limit (1 to ${String(INBOX_LIMITS.max)}, default ${String(INBOX_LIMITS.default)}). Items carry only a title; open href or use the app's own get tool for the content. Mark items with mark_inbox.`,
  schema: z.object({
    state: z.enum(['open', 'unread', 'read', 'done', 'all']).optional(),
    app: z.string().optional(),
    limit: z.number().int().optional(),
  }),
  async handler({ ctx, actor, correlationId }, input) {
    return listInbox(ctx, {
      actor,
      ...(input.state === undefined ? {} : { state: input.state }),
      ...(input.app === undefined ? {} : { app: input.app }),
      ...(input.limit === undefined ? {} : { limit: input.limit }),
      ...(correlationId === undefined ? {} : { correlationId }),
    });
  },
});

export const markInboxTool = defineTool({
  name: 'mark_inbox',
  title: 'Mark inbox items',
  description: `Marks items of your own inbox as read, unread or done. Arguments: ids (1 to ${String(INBOX_LIMITS.markMax)} ids from list_inbox), state (read, unread or done). Returns {updated}: ids that are not yours, unknown or from an app you may no longer read are left alone and not counted.`,
  schema: z.object({
    ids: z.array(z.string()).min(1).max(INBOX_LIMITS.markMax),
    state: z.enum(['read', 'unread', 'done']),
  }),
  async handler({ ctx, actor, correlationId }, input) {
    return markInbox(ctx, {
      actor,
      ids: input.ids,
      state: input.state,
      ...(correlationId === undefined ? {} : { correlationId }),
    });
  },
});

/* -------------------------------------------------------------------------- */
/* Verweise zwischen Apps (ADR 0023)                                           */
/* -------------------------------------------------------------------------- */

/**
 * Verweise aufloesen, dieselbe Domaenenfunktion wie die Chips im Browser
 * (`GET /_platform/refs/resolve`). Ein Agent bekommt einen Titel nur mit
 * `read` auf die Ziel-App und `execute` auf ihren Resolver; sonst
 * `restricted`, ohne Titel und ohne App-Namen.
 */
export const resolveRefsTool = defineTool({
  name: 'resolve_refs',
  title: 'Resolve references',
  description: `Resolves references to objects in other apps, as they appear in text as @{app:type:id} (for example @{tasks:task:42}, @{wiki:page:9f2c}) or to people as @{human:email}. Argument: refs (1 to ${String(REF_RESOLVE_LIMITS.refs)} references without the @{ }). Returns {results: [{ref, state, ...}]} in the same order. state is resolved (with app, appTitle, type, id, title, path, href, status, updatedAt for objects; with kind and title for people, groups and agents), restricted (you may not read that app; no title, no app name), not_found (the app has no such object) or unavailable (the app did not answer in time). For an object you need read on the app and execute on its resolver tool (see list_grants). Titles are cached for up to 60 seconds; permissions are checked on every call.`,
  schema: z.object({
    refs: z.array(z.string()).min(1).max(REF_RESOLVE_LIMITS.refs),
  }),
  async handler({ ctx, actor, correlationId, invoker, refCache }, input) {
    if (invoker === undefined) {
      throw new Error('resolve_refs is not available here: no connection to the apps');
    }
    return resolveRefs(ctx, {
      actor,
      refs: input.refs,
      invoker,
      ...(refCache === undefined ? {} : { cache: refCache }),
      ...(correlationId === undefined ? {} : { correlationId }),
    });
  },
});

export const listBacklinksTool = defineTool({
  name: 'list_backlinks',
  title: 'List backlinks',
  description: `Lists what points to an object from other places: pages, tasks, deals or notes that link to it (kind link), mention it, or were created from it (kind derived). Argument: ref, an object reference app:type:id (for example tasks:task:42). Returns {ref, backlinks: [{source, kind, app, appTitle, updatedAt}]}, newest first, at most ${String(REF_LIST_LIMITS.backlinks)}. You only see a backlink if you may read both the app of the object and the app of the source; otherwise it is left out silently. Resolve the sources with resolve_refs to get their titles.`,
  schema: z.object({ ref: z.string() }),
  async handler({ ctx, actor, correlationId }, input) {
    return listBacklinks(ctx, {
      actor,
      ref: input.ref,
      ...(correlationId === undefined ? {} : { correlationId }),
    });
  },
});

export const listPeopleTool = defineTool({
  name: 'list_people',
  title: 'List people to mention',
  description: `Lists the people and agents you can mention in an app: everyone with read on that app, directly, through a group or through app:*. Arguments: app (app name), q (optional text in name, email or agent name), limit (1 to ${String(REF_LIST_LIMITS.peopleMax)}, default ${String(REF_LIST_LIMITS.peopleDefault)}). Returns {app, people: [{ref, kind, label, detail}]}; put a ref into text as @{ref}, for example @{human:anna@example.com}. Only if you may read the app yourself; otherwise the list is empty. Someone without access to the app does not appear and is not notified when mentioned.`,
  schema: z.object({
    app: z.string(),
    q: z.string().max(REF_LIST_LIMITS.queryMax).optional(),
    limit: z.number().int().optional(),
  }),
  async handler({ ctx, actor, correlationId }, input) {
    return listPeople(ctx, {
      actor,
      app: input.app,
      ...(input.q === undefined ? {} : { q: input.q }),
      ...(input.limit === undefined ? {} : { limit: input.limit }),
      ...(correlationId === undefined ? {} : { correlationId }),
    });
  },
});

export const listActionsTool = defineTool({
  name: 'list_actions',
  title: 'List actions for an object',
  description: `Lists what other apps can create from an object, for example "Create task" from a wiki page (tasks.create_from_ref). Arguments: ref (object reference app:type:id), excerpt (optional short text, up to ${String(REF_LIST_LIMITS.excerptMax)} characters, for the link a person opens). Returns {ref, actions: [{app, appTitle, name, title, tool}]}: only actions whose tool you may execute. Call the tool with {sourceRef: ref, excerpt?} through its app tool; the new object then shows up in list_backlinks of the source with kind derived.`,
  schema: z.object({
    ref: z.string(),
    excerpt: z
      .string()
      .max(REF_LIST_LIMITS.excerptMax * 4)
      .optional(),
  }),
  async handler({ ctx, actor, correlationId }, input) {
    return listActions(ctx, {
      actor,
      ref: input.ref,
      ...(input.excerpt === undefined ? {} : { excerpt: input.excerpt }),
      ...(correlationId === undefined ? {} : { correlationId }),
    });
  },
});

/* -------------------------------------------------------------------------- */
/* Plattform-Agents und Team-Gedaechtnis (ADR 0024)                            */
/* -------------------------------------------------------------------------- */

export const configureAgentTool = defineTool({
  name: 'configure_agent',
  title: 'Configure platform agent',
  description: `Creates or updates the profile of a platform agent: an agent identity (create_agent) that runs inside the platform with the configured chat model. Needs write on agent:<name>. Arguments: name, instructions (1 to ${String(AGENT_PROFILE_LIMITS.instructionsMax)} characters, what the agent does), model (optional, another model name of the configured chat provider; without it the platform model applies), maxSteps (1 to ${String(AGENT_PROFILE_LIMITS.stepsMax)}, default ${String(AGENT_PROFILE_LIMITS.stepsDefault)}), tokenBudget (tokens per run, ${String(AGENT_PROFILE_LIMITS.tokenBudgetMin)} to ${String(AGENT_PROFILE_LIMITS.tokenBudgetMax)}, default ${String(AGENT_PROFILE_LIMITS.tokenBudgetDefault)}). A run sees exactly the tools this agent sees over MCP, limited to what the person who starts it may do. Starting a run needs execute on agent:<name>.`,
  schema: z.object({
    name: z.string(),
    instructions: z.string(),
    model: z.string().optional(),
    maxSteps: z.number().int().optional(),
    tokenBudget: z.number().int().optional(),
  }),
  async handler({ ctx, actor, correlationId }, input) {
    const profile = await configureAgent(ctx, {
      actor,
      name: input.name,
      instructions: input.instructions,
      ...(input.model === undefined ? {} : { model: input.model }),
      ...(input.maxSteps === undefined ? {} : { maxSteps: input.maxSteps }),
      ...(input.tokenBudget === undefined ? {} : { tokenBudget: input.tokenBudget }),
      ...(correlationId === undefined ? {} : { correlationId }),
    });
    return { profile };
  },
});

export const listAgentProfilesTool = defineTool({
  name: 'list_agent_profiles',
  title: 'List platform agents',
  description:
    'Lists the platform agents you may see or start: {chat, agents: [{agent, displayName, instructions, model, maxSteps, tokenBudget, canStart, canEdit, updatedAt}]}. chat is not_configured when the platform has no chat model; then no platform agent runs. instructions are only shown with read or write on the agent.',
  schema: z.object({}),
  async handler({ ctx, actor, correlationId }) {
    return listAgentProfiles(ctx, {
      actor,
      ...(correlationId === undefined ? {} : { correlationId }),
    });
  },
});

export const startAgentRunTool = defineTool({
  name: 'start_agent_run',
  title: 'Start platform agent run',
  description: `Starts a run of a platform agent with your request. Needs execute on agent:<name>. The run sees the tools of that agent, limited to what you may do yourself, and every tool call is audited with the run id. Arguments: agent (name), prompt (1 to ${String(AGENT_RUN_LIMITS.promptMax)} characters). Returns {run} with status queued; poll get_agent_run for the result. Without a chat model on the platform the answer is not_configured.`,
  schema: z.object({ agent: z.string(), prompt: z.string() }),
  async handler({ ctx, actor, correlationId }, input) {
    const run = await startAgentRun(ctx, {
      actor,
      agent: input.agent,
      prompt: input.prompt,
      ...(correlationId === undefined ? {} : { correlationId }),
    });
    return { run };
  },
});

export const getAgentRunTool = defineTool({
  name: 'get_agent_run',
  title: 'Get platform agent run',
  description:
    'Shows one run: {run: {id, agent, status (queued, running, succeeded, failed), trigger, prompt, result, error, steps, tokens, usedApps, toolCalls, createdAt, startedAt, finishedAt}}. You see a run you started, a run of an agent you may write, or your own runs as an agent, and only while you may read every app in usedApps.',
  schema: z.object({ id: z.string() }),
  async handler({ ctx, actor, correlationId }, input) {
    const run = await getAgentRun(ctx, {
      actor,
      id: input.id,
      ...(correlationId === undefined ? {} : { correlationId }),
    });
    return { run };
  },
});

export const listAgentRunsTool = defineTool({
  name: 'list_agent_runs',
  title: 'List platform agent runs',
  description: `Lists runs you started and runs of agents you may write, newest first, the same fields as get_agent_run. Arguments: agent (optional name), limit (1 to ${String(AGENT_RUN_LIMITS.listMax)}, default ${String(AGENT_RUN_LIMITS.listDefault)}).`,
  schema: z.object({ agent: z.string().optional(), limit: z.number().int().optional() }),
  async handler({ ctx, actor, correlationId }, input) {
    return listAgentRuns(ctx, {
      actor,
      ...(input.agent === undefined ? {} : { agent: input.agent }),
      ...(input.limit === undefined ? {} : { limit: input.limit }),
      ...(correlationId === undefined ? {} : { correlationId }),
    });
  },
});

export const rememberTool = defineTool({
  name: 'remember',
  title: 'Remember for the team',
  description: `Stores a short note in the team memory that other agents can recall. Needs execute on tool platform.remember. Arguments: text (1 to ${String(MEMORY_LIMITS.textMax)} characters), apps (optional app names whose content the note is based on). Every note carries its origin: in a platform run all apps whose content the run has seen so far, otherwise all apps you may read now, plus apps you name. You cannot make the origin smaller. A note is only shown to callers who may read every app of its origin.`,
  schema: z.object({
    text: z.string(),
    apps: z.array(z.string()).max(MEMORY_LIMITS.appsMax).optional(),
  }),
  async handler({ ctx, actor, correlationId, run }, input) {
    const memory = await remember(ctx, {
      actor,
      text: input.text,
      ...(input.apps === undefined ? {} : { apps: input.apps }),
      ...(run === undefined ? {} : { run }),
      ...(correlationId === undefined ? {} : { correlationId }),
    });
    return { memory };
  },
});

export const recallTool = defineTool({
  name: 'recall',
  title: 'Recall from the team memory',
  description: `Searches the team memory: {memories: [{id, author, text, apps, runId, createdAt}]}. Needs execute on tool platform.recall. Only notes whose whole origin (apps) you may read appear. Arguments: query (${String(MEMORY_LIMITS.queryMin)} to ${String(MEMORY_LIMITS.queryMax)} characters), limit (1 to ${String(MEMORY_LIMITS.recallMax)}, default ${String(MEMORY_LIMITS.recallDefault)}).`,
  schema: z.object({ query: z.string(), limit: z.number().int().optional() }),
  async handler({ ctx, actor, correlationId }, input) {
    return recall(ctx, {
      actor,
      query: input.query,
      ...(input.limit === undefined ? {} : { limit: input.limit }),
      ...(correlationId === undefined ? {} : { correlationId }),
    });
  },
});

export const listMemoriesTool = defineTool({
  name: 'list_memories',
  title: 'List team memory',
  description: `Lists the newest notes of the team memory you may read. Without agent it needs execute on tool platform.recall; with agent (name) it lists that agent's notes and needs write on agent:<name> or being that agent. Arguments: agent (optional), limit (1 to ${String(MEMORY_LIMITS.listMax)}, default ${String(MEMORY_LIMITS.listDefault)}).`,
  schema: z.object({ agent: z.string().optional(), limit: z.number().int().optional() }),
  async handler({ ctx, actor, correlationId }, input) {
    return listMemories(ctx, {
      actor,
      ...(input.agent === undefined ? {} : { agent: input.agent }),
      ...(input.limit === undefined ? {} : { limit: input.limit }),
      ...(correlationId === undefined ? {} : { correlationId }),
    });
  },
});

export const forgetTool = defineTool({
  name: 'forget',
  title: 'Forget a note',
  description:
    'Deletes a note from the team memory for good. Allowed for the agent that wrote it (with execute on tool platform.remember) and for whoever has write on that agent, and only for a note you may read. Argument: id. Returns {forgotten}.',
  schema: z.object({ id: z.string() }),
  async handler({ ctx, actor, correlationId }, input) {
    return forget(ctx, {
      actor,
      id: input.id,
      ...(correlationId === undefined ? {} : { correlationId }),
    });
  },
});

/**
 * Die sechs Tools des Briefs, `list_grants` und `whoami` zum Nachsehen,
 * `search` ueber alle Apps, der eigene Eingang (ADR 0022), die Verweise
 * zwischen Apps (ADR 0023), die Gruppenpflege, die Agent-Identitaeten, die
 * Plattform-Agents und das Team-Gedaechtnis (ADR 0024). Mehr gibt es nicht: jede weitere
 * Plattform-Aktion entsteht erst als Domaenenfunktion.
 */
export const platformTools: readonly AnyToolDefinition[] = [
  createAppTool,
  requestDeployTool,
  listAppsTool,
  rollbackTool,
  grantTool,
  revokeTool,
  listGrantsTool,
  whoamiTool,
  searchTool,
  listInboxTool,
  markInboxTool,
  resolveRefsTool,
  listBacklinksTool,
  listPeopleTool,
  listActionsTool,
  listGroupsTool,
  createGroupTool,
  listGroupMembersTool,
  grantGroupMemberTool,
  revokeGroupMemberTool,
  listAgentsTool,
  createAgentTool,
  disableAgentTool,
  configureAgentTool,
  listAgentProfilesTool,
  startAgentRunTool,
  getAgentRunTool,
  listAgentRunsTool,
  rememberTool,
  recallTool,
  listMemoriesTool,
  forgetTool,
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
