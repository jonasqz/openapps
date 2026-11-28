/**
 * Der eine Cache aufgeloester Verweise in diesem Prozess (ADR 0023 B, 60 s
 * je Verweis). Er haelt nur Antworten der Resolver, nie eine
 * Rechteentscheidung; die prueft `resolveRefs` bei jedem Aufruf davor.
 * Route und Plattform-MCP teilen ihn.
 */

import { createRefCache, type RefCache } from '../domain';

let cache: RefCache | undefined;

export function sharedRefCache(): RefCache {
  cache ??= createRefCache();
  return cache;
}
