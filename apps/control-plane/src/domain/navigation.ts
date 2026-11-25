/**
 * Was die gemeinsame Leiste einer Person zeigt (ADR 0017). Die Rechte dafuer
 * prueft die Control Plane, die App bekommt nur das Ergebnis als signierten
 * Header (`gateway-headers.ts`, `navHeadersForApp`).
 *
 * Die Navigation ist Anzeige, keine Freigabe: Ob jemand eine App oeffnen
 * darf, entscheidet weiter die Forward-Auth beim Aufruf dieser App.
 */

import type { PlatformNav, PlatformNavApp } from '@openapps/sdk';
import { canAccessApp } from './apps';
import { can } from './can';
import type { DomainContext } from './context';
import { gatewayHost } from './gateway-identity';
import { appPathFor } from './naming';
import { ANY, type Actor } from './types';

/**
 * Die Gruppe der Plattform-Administratoren (Migration 0009). Derselbe Name
 * wie `BOOTSTRAP_GROUP` in `lib/auth-policy.ts`; die Domaene importiert nicht
 * aus `lib`, deshalb steht er hier ein zweites Mal.
 */
export const PLATFORM_ADMINS_GROUP = 'platform-admins';

/**
 * Die Apps, die die Person lesen darf: nicht archiviert, mit Domain, und mit
 * `read` ueber `canAccessApp` — dieselbe Pruefung wie die Forward-Auth.
 * Default-Deny: ohne Freigabe keine App in der Liste.
 */
export async function visibleAppsFor(
  ctx: DomainContext,
  actor: Actor,
): Promise<readonly PlatformNavApp[]> {
  const all = await ctx.apps.listAll();
  const visible: PlatformNavApp[] = [];
  for (const app of all) {
    // `listAll` filtert Archiviertes schon; die Stelle, die entscheidet,
    // prueft es trotzdem selbst (wie `findAppForPath` in der Forward-Auth).
    if (app.archivedAt !== null || app.primaryDomain === null) continue;
    if (!(await canAccessApp(ctx, actor, 'read', app))) continue;
    visible.push({
      name: app.name,
      title: app.displayName,
      category: app.category,
      href: `https://${gatewayHost(app.primaryDomain)}${appPathFor(app.name)}`,
    });
  }
  return visible;
}

/**
 * Darf die Person Apps anlegen? Dieselbe Pruefung wie `createApp`:
 * `write` auf `app:*`.
 */
export function canCreateApps(ctx: DomainContext, actor: Actor): Promise<boolean> {
  return can(ctx, actor, 'write', { kind: 'app', id: ANY });
}

/** Mitglied in `platform-admins`. Nur Anzeige, oeffnet nichts. */
export function isPlatformAdmin(actor: Actor): boolean {
  return (actor.groups ?? []).includes(PLATFORM_ADMINS_GROUP);
}

/** Die vollstaendige Navigation fuer eine Person. */
export async function platformNavFor(
  ctx: DomainContext,
  actor: Actor,
  options: { readonly controlPlaneHost: string },
): Promise<PlatformNav> {
  return {
    v: 1,
    platformUrl: `https://${options.controlPlaneHost}`,
    apps: await visibleAppsFor(ctx, actor),
    canCreateApps: await canCreateApps(ctx, actor),
    isAdmin: isPlatformAdmin(actor),
  };
}
