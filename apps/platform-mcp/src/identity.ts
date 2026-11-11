/**
 * Wer ruft das Tool? Ein Agent hat eine eigene Identitaet (OAuth-Client), und
 * sie ist dasselbe Subjekt wie ein Mensch — nur mit `kind: 'agent'`. Damit
 * gilt fuer ihn dasselbe Rechtemodell, ohne Sonderfall.
 */

import { timingSafeEqual } from 'node:crypto';
import { hashAgentSecret, type Actor, type DomainContext } from '@openapps/control-plane/domain';

export class UnauthenticatedError extends Error {
  constructor(message = 'unbekannter oder gesperrter Client') {
    super(message);
    this.name = 'UnauthenticatedError';
  }
}

/**
 * Secrets werden nur als Hash gespeichert und nur als Hash verglichen. Die
 * Funktion selbst liegt in der Domaene — dort entsteht das Secret, und
 * Anlegen und Pruefen duerfen nicht auseinanderlaufen.
 */
export const hashClientSecret = hashAgentSecret;

export async function actorForClient(
  ctx: DomainContext,
  clientId: string,
  clientSecret: string,
): Promise<Actor> {
  const identity = await ctx.agents.findByClientId(clientId);
  const storedHash = await ctx.agents.secretHashOf(clientId);
  if (identity === null || storedHash === null) {
    throw new UnauthenticatedError();
  }

  const given = Buffer.from(hashClientSecret(clientSecret));
  const expected = Buffer.from(storedHash);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new UnauthenticatedError();
  }

  await ctx.agents.touch(clientId, ctx.clock.now());
  return { kind: 'agent', id: identity.name };
}
