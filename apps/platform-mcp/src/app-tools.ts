/**
 * Die Weiterleitung der App-Tools.
 *
 * Ein Agent sieht nur die Tools, fuer die er eine Freigabe hat — und wird ohne
 * Freigabe **blockiert**, nicht nur nicht beliefert. Beides ist nicht dasselbe:
 * Ausblenden ist Bequemlichkeit, Blockieren ist die Durchsetzung. Deshalb
 * prueft `callAppTool` noch einmal, auch wenn `listAppTools` das Tool gar nicht
 * angeboten hat (DoD 6).
 */

import {
  audited,
  can,
  PermissionDeniedError,
  type Actor,
  type App,
  type DomainContext,
} from '@openapps/control-plane/domain';

export interface AppToolRef {
  readonly appName: string;
  readonly toolName: string;
  /** Ressourcen-Id im Rechtemodell: `<app-name>.<tool>`. */
  readonly resourceId: string;
  readonly description: string | undefined;
}

/** Ruft das Tool in der App auf. In v1 ein HTTP-Aufruf gegen ihre OpenAPI-Spec. */
export interface AppToolInvoker {
  invoke(input: {
    readonly app: App;
    readonly toolName: string;
    readonly actor: Actor;
    readonly args: Readonly<Record<string, unknown>>;
  }): Promise<unknown>;
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
 * Ruft ein App-Tool auf. Der Reihenfolge nach: Freigabe pruefen, protokollieren,
 * weiterleiten. Es gibt keinen Pfad, der die erste Pruefung ueberspringt.
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
        throw new PermissionDeniedError(`unbekanntes Tool "${input.toolResourceId}"`);
      }

      const allowed = await can(ctx, input.actor, 'execute', {
        kind: 'tool',
        id: input.toolResourceId,
      });
      if (!allowed) {
        throw new PermissionDeniedError(
          `${input.actor.kind}:${input.actor.id} darf "${input.toolResourceId}" nicht aufrufen`,
        );
      }

      const app = await ctx.apps.findByName(appName);
      if (app === null) {
        // Eine Freigabe auf eine App, die es nicht gibt, oeffnet nichts.
        throw new PermissionDeniedError(`App "${appName}" gibt es nicht`);
      }

      // Das Tool muss auch im Manifest stehen. Sonst waere eine alte Freigabe
      // ein Zugang zu etwas, das die App nicht mehr anbietet.
      const declared = app.manifest.offeredTools.some((t) => t.name === toolName);
      if (!declared) {
        throw new PermissionDeniedError(`App "${appName}" bietet kein Tool "${toolName}"`);
      }

      const value = await input.invoker.invoke({
        app,
        toolName,
        actor: input.actor,
        args: input.args ?? {},
      });

      return { value, detail: { forwarded: true } };
    },
  );
}
