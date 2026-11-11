/**
 * Agent-Identitaeten als Domaenenfunktion — damit ein Agent ueber API und MCP
 * hereinkommt und nicht ueber eine Zeile SQL (CLAUDE.md, Grundsatz 1).
 *
 * Ein Agent ist dasselbe Subjekt wie ein Mensch, nur mit `kind: 'agent'`
 * (Grundsatz 4). Seit Migration 0014 ist seine Identitaet ausserdem eine
 * **Ressource**:
 *
 * | Recht                   | Was es erlaubt                              |
 * | ----------------------- | ------------------------------------------- |
 * | `read` auf `agent:<n>`  | die Identitaet sehen — nie ihr Secret        |
 * | `write` auf `agent:<n>` | die Identitaet sperren                       |
 * | `write` auf `agent:*`   | zusaetzlich neue Identitaeten anlegen        |
 *
 * Drei Dinge, die hier absichtlich so sind:
 *
 *  1. **Das Secret gibt es genau einmal**: in der Antwort auf das Anlegen.
 *     Gespeichert wird nur sein Hash. Wer es verliert, legt eine neue
 *     Identitaet an und sperrt die alte — ein „Secret anzeigen" gibt es nicht.
 *  2. **Eine neue Identitaet darf nichts** (Default-Deny). Was der Agent tun
 *     darf, vergibt danach `grant` — bewusst ein zweiter Schritt, damit
 *     niemand mit dem Anlegen versehentlich Rechte verteilt.
 *  3. **Sperren statt loeschen.** Der Name bleibt vergeben, die Zeile bleibt
 *     stehen: Im Audit-Log steht `agent:<name>`, und der Name soll nie auf
 *     einen anderen Agent zeigen als damals.
 */

import { createHash, randomBytes } from 'node:crypto';
import { audited } from './audit';
import { can, requirePermission } from './can';
import { ConflictError, NotFoundError, ValidationError } from './errors';
import { ANY } from './types';
import type { DomainContext } from './context';
import type { Actor, AgentIdentity, ResourceRef } from './types';

/** Dieselbe Form wie der CHECK in Migration 0005. */
const AGENT_NAME = /^[a-z][a-z0-9-]{1,62}$/;

function agentResource(name: string): ResourceRef {
  return { kind: 'agent', id: name };
}

function assertAgentName(name: string): string {
  if (!AGENT_NAME.test(name)) {
    throw new ValidationError(
      `"${name}" taugt nicht als Agent-Name: klein geschrieben, 2 bis 63 Zeichen, ` +
        'Buchstaben, Ziffern und Bindestriche, mit einem Buchstaben vorn',
    );
  }
  return name;
}

/**
 * Secrets werden nur als Hash gespeichert und nur als Hash verglichen. SHA-256
 * ohne Salt und ohne Streckung reicht hier, weil das Secret kein Passwort ist:
 * 32 zufaellige Bytes, die niemand sich ausgedacht hat und niemand raten kann.
 */
export function hashAgentSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/**
 * Das Token, das ein Agent als `Authorization: Bearer …` schickt: Client-Id
 * und Secret, durch einen Punkt getrennt. Weder die Id (`oac_` + Hex) noch das
 * Secret (base64url) enthaelt einen Punkt — der erste trennt also eindeutig.
 */
export function agentToken(clientId: string, secret: string): string {
  return `${clientId}.${secret}`;
}

export function parseAgentToken(token: string): { clientId: string; secret: string } | null {
  const separator = token.indexOf('.');
  if (separator <= 0 || separator === token.length - 1) return null;
  return { clientId: token.slice(0, separator), secret: token.slice(separator + 1) };
}

export interface CreatedAgentIdentity {
  readonly agent: AgentIdentity;
  /** Nur in dieser einen Antwort. Danach kennt es niemand mehr. */
  readonly clientSecret: string;
  /** `<clientId>.<secret>` — fertig fuer `Authorization: Bearer`. */
  readonly token: string;
}

export async function createAgentIdentity(
  ctx: DomainContext,
  input: { actor: Actor; name: string; displayName?: string; correlationId?: string },
): Promise<CreatedAgentIdentity> {
  return audited(
    ctx,
    {
      actor: input.actor,
      action: 'create_agent',
      resource: agentResource(input.name),
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    },
    async () => {
      const name = assertAgentName(input.name);
      // Die Wildcard, nicht der eigene Name: Vor dem Anlegen gibt es den Namen
      // nicht (dieselbe Regel wie bei Gruppen).
      await requirePermission(ctx, input.actor, 'write', agentResource(ANY));
      if ((await ctx.agents.findByName(name)) !== null) {
        // Auch eine gesperrte Identitaet haelt ihren Namen (Dateikopf, Punkt 3).
        throw new ConflictError(`Agent "${name}" gibt es schon`);
      }

      const clientId = `oac_${randomBytes(12).toString('hex')}`;
      const clientSecret = randomBytes(32).toString('base64url');
      const agent = await ctx.agents.create({
        name,
        displayName: input.displayName?.trim() || name,
        ownerUserId: `${input.actor.kind}:${input.actor.id}`,
        oauthClientId: clientId,
        oauthClientSecretHash: hashAgentSecret(clientSecret),
      });

      return {
        value: { agent, clientSecret, token: agentToken(clientId, clientSecret) },
        // Die Client-Id darf ins Log, das Secret nie.
        detail: { clientId },
      };
    },
  );
}

/**
 * Die Identitaeten, die dieser Aufrufer sehen darf — gefiltert wie
 * `listGroups`. Gesperrte stehen mit drin: Wer gesperrt wurde und wann,
 * gehoert zur Antwort auf „wer kommt hier herein".
 */
export async function listAgentIdentities(
  ctx: DomainContext,
  input: { actor: Actor; correlationId?: string },
): Promise<readonly AgentIdentity[]> {
  const all = await ctx.agents.list();
  const visible: AgentIdentity[] = [];
  for (const agent of all) {
    if (await can(ctx, input.actor, 'read', agentResource(agent.name))) visible.push(agent);
  }

  await ctx.audit.append({
    occurredAt: ctx.clock.now(),
    actor: { kind: input.actor.kind, id: input.actor.id },
    action: 'list_agents',
    resource: agentResource(ANY),
    outcome: 'allowed',
    reason: null,
    detail: { visible: visible.length, total: all.length },
    correlationId: input.correlationId ?? null,
  });

  return visible;
}

/**
 * Sperrt eine Identitaet. Wirkt beim naechsten Aufruf: Der Plattform-MCP
 * prueft Id und Secret bei **jedem** Aufruf gegen die Datenbank, es gibt
 * keine Session und keinen Cache. Idempotent — eine schon gesperrte bleibt
 * gesperrt, mit ihrem ersten Zeitpunkt.
 */
export async function disableAgentIdentity(
  ctx: DomainContext,
  input: { actor: Actor; name: string; correlationId?: string },
): Promise<{ readonly agent: AgentIdentity; readonly disabled: boolean }> {
  return audited(
    ctx,
    {
      actor: input.actor,
      action: 'disable_agent',
      resource: agentResource(input.name),
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    },
    async () => {
      const existing = await ctx.agents.findByName(assertAgentName(input.name));
      if (existing === null) throw new NotFoundError(`Agent "${input.name}" gibt es nicht`);
      await requirePermission(ctx, input.actor, 'write', agentResource(existing.name));

      const disabled = existing.disabledAt === null;
      const agent = disabled ? await ctx.agents.disable(existing.name, ctx.clock.now()) : existing;
      return { value: { agent, disabled }, detail: { disabled } };
    },
  );
}
