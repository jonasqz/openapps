/**
 * Der Aufruf eines App-Tools durch einen Agenten (Plattform-MCP, ADR 0011)
 * oder durch eine andere App (ADR 0020). Beide Wege laufen durch diese eine
 * Funktion, damit Freigabe, Audit und Weiterleitung nicht auseinanderlaufen.
 *
 * Ein Aufrufer sieht nur die Tools, fuer die er eine Freigabe hat — und wird
 * ohne Freigabe **blockiert**, nicht nur nicht beliefert. Ausblenden ist
 * Bequemlichkeit, Blockieren ist die Durchsetzung. Deshalb prueft
 * `callAppTool` noch einmal, auch wenn `listAppTools` das Tool gar nicht
 * angeboten hat (DoD 6).
 */

import { audited } from './audit';
import { can } from './can';
import type { DomainContext } from './context';
import { PermissionDeniedError } from './errors';
import type { GatewayIdentity } from './gateway-headers';
import { readableAppsForTarget } from './readable-apps';
import type { Actor, App } from './types';

export interface AppToolRef {
  readonly appName: string;
  readonly toolName: string;
  /** Ressourcen-Id im Rechtemodell: `<app-name>.<tool>`. */
  readonly resourceId: string;
  readonly description: string | undefined;
}

/** Ruft das Tool in der App auf. In v1 ein HTTP-Aufruf gegen ihren Tool-Endpunkt. */
export interface AppToolInvoker {
  invoke(input: {
    readonly app: App;
    readonly toolName: string;
    readonly actor: Actor;
    readonly args: Readonly<Record<string, unknown>>;
    /**
     * Lesbare Apps des Aufrufers (ADR 0020), nur wenn das Manifest der
     * Ziel-App sie anfordert. `null` oder fehlend: Header leer.
     */
    readonly readableApps?: readonly string[] | null;
  }): Promise<unknown>;
}

/**
 * Die Ziel-App hat mit einem Fehler geantwortet. Traegt ihren Status und
 * ihre Antwort, damit der Aufrufer (Agent oder App) seinen Aufruf
 * korrigieren kann. Kein Fehler der Plattform, keine verweigerte Freigabe.
 */
export class AppToolError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'AppToolError';
    this.status = status;
    this.body = body;
  }
}

/** Domain der E-Mail, unter der eine App als Aufrufer erscheint. `.invalid` ist nie echt. */
export const APP_CALLER_EMAIL_DOMAIN = 'apps.invalid';
export const AGENT_CALLER_EMAIL_DOMAIN = 'agents.invalid';

/**
 * Wie ein Agent oder eine App in der Ziel-App erscheint: in den fuenf
 * Identitaets-Headern, mit `agent:<name>` bzw. `app:<name>` als Nutzer-Id.
 * `callerOf` im SDK liest genau diese Form zurueck. Menschen rufen App-Tools
 * nicht ueber diesen Weg — sie kommen durch die Forward-Auth.
 */
export function callerIdentityFor(actor: Actor, issuedAt: number): GatewayIdentity {
  if (actor.kind === 'agent') {
    return {
      userId: `agent:${actor.id}`,
      email: `${actor.id}@${AGENT_CALLER_EMAIL_DOMAIN}`,
      groups: [],
      issuedAt,
    };
  }
  if (actor.kind === 'app') {
    return {
      userId: `app:${actor.id}`,
      email: `${actor.id}@${APP_CALLER_EMAIL_DOMAIN}`,
      groups: [],
      issuedAt,
    };
  }
  throw new PermissionDeniedError(`${actor.kind}:${actor.id} cannot call app tools directly`);
}

/** Welche App-Tools darf dieser Aufrufer sehen? */
export async function listAppTools(
  ctx: DomainContext,
  actor: Actor,
): Promise<readonly AppToolRef[]> {
  const apps = await ctx.apps.listAll();
  const visible: AppToolRef[] = [];

  for (const app of apps) {
    for (const tool of app.manifest.offeredTools) {
      const resourceId = `${app.name}.${tool.name}`;
      if (await can(ctx, actor, 'execute', { kind: 'tool', id: resourceId })) {
        visible.push({
          appName: app.name,
          toolName: tool.name,
          resourceId,
          description: tool.description,
        });
      }
    }
  }

  return visible;
}

/**
 * Ruft ein App-Tool auf. Der Reihenfolge nach: Freigabe pruefen,
 * protokollieren, weiterleiten. Es gibt keinen Pfad, der die erste Pruefung
 * ueberspringt.
 */
export async function callAppTool(
  ctx: DomainContext,
  input: {
    readonly actor: Actor;
    /** `<app-name>.<tool>` */
    readonly toolResourceId: string;
    readonly args?: Readonly<Record<string, unknown>>;
    readonly invoker: AppToolInvoker;
    readonly correlationId?: string;
  },
): Promise<unknown> {
  const separator = input.toolResourceId.indexOf('.');
  const appName = separator === -1 ? '' : input.toolResourceId.slice(0, separator);
  const toolName = separator === -1 ? '' : input.toolResourceId.slice(separator + 1);

  return audited(
    ctx,
    {
      actor: input.actor,
      action: 'call_app_tool',
      resource: { kind: 'tool', id: input.toolResourceId },
      detail: { appName, toolName },
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    },
    async () => {
      if (appName === '' || toolName === '') {
        throw new PermissionDeniedError(`unknown tool "${input.toolResourceId}"`);
      }

      const allowed = await can(ctx, input.actor, 'execute', {
        kind: 'tool',
        id: input.toolResourceId,
      });
      if (!allowed) {
        throw new PermissionDeniedError(
          `${input.actor.kind}:${input.actor.id} may not call "${input.toolResourceId}"`,
        );
      }

      const app = await ctx.apps.findByName(appName);
      if (app === null || app.archivedAt !== null) {
        // Eine Freigabe auf eine App, die es nicht (mehr) gibt, oeffnet nichts.
        throw new PermissionDeniedError(`app "${appName}" does not exist`);
      }

      // Das Tool muss auch im Manifest stehen. Sonst waere eine alte Freigabe
      // ein Zugang zu etwas, das die App nicht mehr anbietet.
      const declared = app.manifest.offeredTools.some((t) => t.name === toolName);
      if (!declared) {
        throw new PermissionDeniedError(`app "${appName}" offers no tool "${toolName}"`);
      }

      const readableApps = await readableAppsForTarget(ctx, input.actor, app);
      const value = await input.invoker.invoke({
        app,
        toolName,
        actor: input.actor,
        args: input.args ?? {},
        readableApps,
      });

      return { value, detail: { forwarded: true } };
    },
  );
}
