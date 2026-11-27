/**
 * Welche Apps darf ein Aufrufer lesen (ADR 0020)? Das Ergebnis geht als
 * signierter Header an Apps, die Inhalte anderer Apps zeigen (Knowledge).
 * Die Pruefung liegt hier, in der Control Plane, und nirgends sonst.
 *
 * Anders als die Navigation (`navigation.ts`) ist das ein Filter: Er zaehlt
 * jede nicht archivierte App, auch ohne Domain, und wird nur gekuerzt, wenn
 * er nicht in den Header passt — und dann zeigt er weniger, nie mehr.
 */

import { canAccessApp } from './apps';
import type { DomainContext } from './context';
import type { Actor, App } from './types';

/** Fordert das Manifest der App die lesbaren Apps an? */
export function wantsReadableApps(app: Pick<App, 'manifest'>): boolean {
  return (app.manifest.gatewayContext ?? []).includes('readableApps');
}

/**
 * Die Namen der Apps, auf die der Aufrufer `read` hat — dieselbe Pruefung wie
 * die Forward-Auth (`canAccessApp`). Archivierte Apps fehlen: Ihre Inhalte
 * sind fuer niemanden mehr sichtbar. Default-Deny: ohne Freigabe leer.
 */
export async function readableAppsFor(
  ctx: DomainContext,
  actor: Actor,
): Promise<readonly string[]> {
  const all = await ctx.apps.listAll();
  const readable: string[] = [];
  for (const app of all) {
    if (app.archivedAt !== null) continue;
    if (await canAccessApp(ctx, actor, 'read', app)) readable.push(app.name);
  }
  return readable.sort();
}

/**
 * Die Liste fuer einen Aufruf an `target`, oder `null`, wenn das Manifest
 * sie nicht anfordert. Scheitert die Berechnung, `null` — die App zeigt dann
 * nichts aus anderen Apps, und der Aufruf selbst geht weiter.
 */
export async function readableAppsForTarget(
  ctx: DomainContext,
  actor: Actor,
  target: Pick<App, 'manifest' | 'name'>,
): Promise<readonly string[] | null> {
  if (!wantsReadableApps(target)) return null;
  try {
    return await readableAppsFor(ctx, actor);
  } catch (error) {
    console.error(`[readable-apps] not computed for ${target.name}`, error);
    return null;
  }
}
